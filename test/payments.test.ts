// الدفعات، والتفعيل الفوري عند إنشاء العائلة، ومهلة الدفع، ومعاينة الأستاذ للموقع كتلميذ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Browser, makeEnv, setupAdmin, type TestEnv } from "./helpers/family.ts";
import { currentTerm, parseAmount, splitAmount } from "../src/payments.ts";

const DAY = 24 * 60 * 60 * 1000;

function isoIn(days: number): string {
  return new Date(Date.now() + days * DAY + 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function setTerms(admin: Browser) {
  await admin.post("/admin/settings", { term1_end: isoIn(40), term2_end: isoIn(130), term3_end: isoIn(220), whatsapp: "0555123456" });
}

/** درس مدفوع منشور في 2 متوسط، ودرس مسودة. */
function seed(env: TestEnv) {
  const t = Date.now() - 10 * DAY;
  env.DB.raw.exec(`
    INSERT INTO units (id, program_slug, title, position, status, published_at, created_at, updated_at) VALUES (10, '2am', 'مقطع', 1, 'published', ${t}, ${t}, ${t});
    INSERT INTO lessons (id, unit_id, kind, title, position, free, status, youtube_id, published_at, created_at, updated_at) VALUES
      (100, 10, 'video', 'درس مدفوع', 1, 0, 'published', 'PAIDvid0001', ${t}, ${t}, ${t}),
      (101, 10, 'video', 'درس مسودة', 2, 0, 'draft', 'DRAFTvid002', NULL, ${t}, ${t});
  `);
}

const NEW_FAMILY = {
  name: "عائلة بن علي",
  phone: "0661223344",
  child_name_1: "ياسين",
  child_level_1: "2am",
  child_package_1: "term1",
  child_name_2: "مريم",
  child_level_2: "2am",
  child_package_2: "year",
};

async function createFamily(admin: Browser, fields: Record<string, string>) {
  const res = await admin.post("/admin/families/new", fields);
  const text = await res.text();
  return { res, text, password: /data-copy-source="password">([a-z0-9-]+)</.exec(text)?.[1] ?? "" };
}

async function loginAs(env: TestEnv, password: string) {
  const parent = new Browser(env);
  await parent.post("/login", { phone: "0661223344", password });
  await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  return parent;
}

function famId(env: TestEnv): number {
  return Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
}

function subs(env: TestEnv) {
  return env.DB.raw.prepare("SELECT s.*, st.name FROM subscriptions s JOIN students st ON st.id = s.student_id ORDER BY s.id").all() as Record<string, number | string | null>[];
}

// ---------- القواعد ----------

test("المبلغ: أرقام بفراغات أو نقاط أو «دج» أو أرقام عربية، والتقسيم بالدينار الكامل", () => {
  assert.equal(parseAmount("4000"), 4000);
  assert.equal(parseAmount("4 000 دج"), 4000);
  assert.equal(parseAmount("4.000"), 4000);
  assert.equal(parseAmount("٤٠٠٠"), 4000);
  assert.equal(parseAmount(""), null);
  assert.ok(Number.isNaN(parseAmount("أربعة آلاف")));
  assert.ok(Number.isNaN(parseAmount("0")));
  assert.deepEqual(splitAmount(6001, 2), [3001, 3000]);
  assert.deepEqual(splitAmount(10000, 3), [3334, 3333, 3333]);
  assert.equal(splitAmount(10000, 3).reduce((a, b) => a + b), 10000);
});

test("الفصل الحالي: أول فصل لم ينته بعد", () => {
  const now = Date.UTC(2027, 0, 15);
  assert.equal(currentTerm({ term1_end: "2026-12-17", term2_end: "2027-03-20", term3_end: "2027-06-30" }, now), "term2");
  assert.equal(currentTerm({ term1_end: "2027-01-20" }, now), "term1");
  assert.equal(currentTerm({}, now), null);
});

// ---------- إنشاء العائلة ----------

test("إنشاء عائلة بمبلغ: كل ابن مفعّل فورًا، والمبلغ يُقسَّم بالتساوي على الأبناء", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin);
  const form = await (await admin.get("/admin/families/new")).text();
  assert.match(form, /الفصل الأول \(حتى/);
  assert.match(form, /<option value="term1" selected>/);
  const { res, password } = await createFamily(admin, { ...NEW_FAMILY, amount: "6 001", receipt: "123" });
  assert.equal(res.status, 200);
  const rows = subs(env);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.kind), ["term1", "year"]);
  assert.deepEqual(rows.map((r) => r.amount), [3001, 3000]);
  assert.ok(rows.every((r) => r.payment_id === rows[0]!.payment_id && r.payment_id !== null && r.pay_due_at === null));
  const payment = env.DB.raw.prepare("SELECT * FROM payments").get() as Record<string, unknown>;
  assert.equal(payment.amount, 6001);
  assert.equal(payment.receipt, "123");
  assert.equal(payment.account_id, famId(env));

  const parent = await loginAs(env, password);
  const kid = env.DB.raw.prepare("SELECT id FROM students WHERE name = 'ياسين'").get()?.id;
  await parent.post("/profiles/select", { kind: "student", student_id: String(kid) });
  assert.equal((await parent.get("/lessons/100")).status, 200);
  const page = await (await admin.get(`/admin/families/${famId(env)}`)).text();
  assert.match(page, /مدفوع · 3[  ]001 دج/);
  assert.match(page, /6[  ]001 دج/);
});

test("بدون مبلغ: مفعّل مع مهلة 15 يومًا، ثم يتوقف، ثم يعود بتسجيل الدفعة", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin);
  const { password } = await createFamily(admin, NEW_FAMILY);
  const rows = subs(env);
  assert.ok(rows.every((r) => r.payment_id === null && Math.abs(Number(r.pay_due_at) - (Date.now() + 15 * DAY)) < 60_000));

  const parent = await loginAs(env, password);
  const kid = env.DB.raw.prepare("SELECT id FROM students WHERE name = 'ياسين'").get()?.id;
  await parent.post("/profiles/select", { kind: "parent" });
  const account = await (await parent.get("/account")).text();
  assert.match(account, /يجب الدفع قبل/);
  assert.match(account, /تواصل للدفع عبر واتساب/);
  await parent.post("/profiles/select", { kind: "student", student_id: String(kid) });
  assert.equal((await parent.get("/lessons/100")).status, 200);
  let dash = await (await admin.get("/admin")).text();
  assert.match(dash, /بانتظار الدفع/);

  // انتهت المهلة
  env.DB.raw.prepare("UPDATE subscriptions SET pay_due_at = ?").run(Date.now() - 1000);
  assert.equal((await parent.get("/lessons/100")).status, 302);
  assert.match(await (await parent.get("/home")).text(), /متوقف: انتهت مهلة الدفع/);
  dash = await (await admin.get("/admin")).text();
  assert.match(dash, /انتهت المهلة: الاشتراك متوقف/);

  // تسجيل الدفعة لاشتراك ياسين فقط
  const yacineSub = rows.find((r) => r.name === "ياسين")!;
  const bad = await admin.post(`/admin/families/${famId(env)}/payments`, { [`sub_${yacineSub.id}`]: "1", amount: "" });
  assert.equal(bad.status, 400);
  const ok = await admin.post(`/admin/families/${famId(env)}/payments`, { [`sub_${yacineSub.id}`]: "1", amount: "2500", receipt: "77" });
  assert.equal(ok.headers.get("Location"), `/admin/families/${famId(env)}?done=paid#subs`);
  assert.equal((await parent.get("/lessons/100")).status, 200);
  const after = subs(env);
  assert.equal(after.find((r) => r.name === "ياسين")!.amount, 2500);
  assert.equal(after.find((r) => r.name === "مريم")!.payment_id, null);
  // مريم ما زالت في القائمة
  assert.match(await (await admin.get("/admin")).text(), /مريم/);
});

test("الأخطاء: الباقة دون تواريخ الفصول، والمبلغ غير المقروء، والمبلغ بلا اشتراك", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const noTerms = await createFamily(admin, NEW_FAMILY);
  assert.equal(noTerms.res.status, 400);
  assert.match(noTerms.text, /تواريخ نهاية الفصول/);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'parent'").get()?.n, 0);
  await setTerms(admin);
  const badAmount = await createFamily(admin, { ...NEW_FAMILY, amount: "أربعة آلاف" });
  assert.match(badAmount.text, /بالأرقام فقط/);
  const noSub = await createFamily(admin, { ...NEW_FAMILY, child_package_1: "none", child_package_2: "none", amount: "3000" });
  assert.match(noSub.text, /لا يوجد اشتراك ليُسجَّل له المبلغ/);
  // بدون اشتراك وبدون مبلغ: مقبول
  const plain = await createFamily(admin, { ...NEW_FAMILY, child_package_1: "none", child_package_2: "none" });
  assert.equal(plain.res.status, 200);
  assert.equal(subs(env).length, 0);
});

test("إضافة ابن لاحقًا: يُفعَّل فورًا مع المبلغ، والتجديد لعدة أبناء بمبلغ واحد", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin);
  await createFamily(admin, { ...NEW_FAMILY, child_name_2: "", child_level_2: "", amount: "3000" });
  const id = famId(env);
  const add = await admin.post(`/admin/families/${id}/children`, { child_name: "أمين", child_level: "4am", child_package: "term1", amount: "2000" });
  assert.equal(add.headers.get("Location"), `/admin/families/${id}?done=child`);
  const amine = subs(env).find((r) => r.name === "أمين")!;
  assert.equal(amine.program_slug, "4am");
  assert.equal(amine.amount, 2000);

  const kids = env.DB.raw.prepare("SELECT id, name FROM students WHERE account_id = ?").all(id) as { id: number; name: string }[];
  const yacine = kids.find((k) => k.name === "ياسين")!.id;
  const res = await admin.post(`/admin/families/${id}/activate`, { [`package_${yacine}`]: "2am:term2", [`package_${kids.find((k) => k.name === "أمين")!.id}`]: "olympiad:course", amount: "9000" });
  assert.equal(res.headers.get("Location"), `/admin/families/${id}?done=sub-activated#subs`);
  const last = subs(env).slice(-2);
  assert.deepEqual(last.map((r) => r.amount), [4500, 4500]);
  assert.equal(env.DB.raw.prepare("SELECT SUM(amount) AS n FROM payments").get()?.n, 14000);
  // مستوى لا يخص الابن مرفوض
  assert.equal((await admin.post(`/admin/families/${id}/activate`, { [`package_${yacine}`]: "4am:term1" })).status, 400);
});

// ---------- معاينة الأستاذ ----------

test("الأستاذ يرى الموقع كتلميذ مشترك أو غير مشترك، والمسودات تختفي في المعاينة", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  let level = await (await admin.get("/levels/2am")).text();
  assert.match(level, /class="preview-bar"/);
  assert.match(level, /درس مسودة/);

  await admin.post("/preview", { mode: "free", back: "/levels/2am" });
  level = await (await admin.get("/levels/2am")).text();
  assert.doesNotMatch(level, /درس مسودة/);
  assert.match(level, /href="\/subscribe\?lesson=100"/);
  assert.equal((await admin.get("/lessons/100")).status, 302);
  assert.equal((await admin.get("/lessons/101")).status, 404);
  assert.match(level, /class="seg seg-on" type="submit" name="mode" value="free"/);

  const sub = await admin.post("/preview", { mode: "subscribed", back: "/levels/2am" });
  assert.equal(sub.headers.get("Location"), "/levels/2am");
  assert.equal((await admin.get("/lessons/100")).status, 200);
  assert.equal((await admin.get("/lessons/101")).status, 404);

  await admin.post("/preview", { mode: "teacher", back: "https://evil.example/" });
  assert.equal((await admin.get("/lessons/101")).status, 200);
  // لوحة التحكم لا تتأثر بالمعاينة
  await admin.post("/preview", { mode: "free" });
  assert.equal((await admin.get("/admin")).status, 200);

  // غير الأستاذ: لا شريط ولا معاينة
  const visitor = new Browser(env);
  assert.doesNotMatch(await (await visitor.get("/levels/2am")).text(), /preview-bar/);
  assert.equal((await visitor.post("/preview", { mode: "subscribed" })).status, 404);
});
