// اختبارات المرحلة 5: الاشتراكات، وقاعدة فتح المحتوى بالتواريخ، والإعدادات، وما يراه الولي.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Browser, FAMILY, createFamily, makeEnv, setupAdmin, type TestEnv } from "./helpers/family.ts";
import {
  COURSE_MS,
  GRACE_MS,
  canOpen,
  computeEnd,
  endOfDay,
  subscriptionStatus,
  type Access,
  type Subscription,
} from "../src/subscriptions.ts";

const DAY = 24 * 60 * 60 * 1000;

/** رقم حساب العائلة التجريبية. */
function famOf(env: TestEnv): number {
  return Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
}
const NOW = Date.UTC(2027, 0, 15, 10);

/** تاريخ بصيغة 2027-01-15 بتوقيت الجزائر، بعد عدد من الأيام من الآن. */
function isoIn(days: number, from = Date.now()): string {
  return new Date(from + days * DAY + 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---------- القواعد (بدون خادم) ----------

test("نهاية اليوم بتوقيت الجزائر، ورفض التواريخ غير الصحيحة", () => {
  assert.equal(endOfDay("2026-12-17"), Date.UTC(2026, 11, 17, 22, 59, 59, 999));
  for (const bad of ["2026-02-30", "2026-13-01", "17/12/2026", "", "2026-1-5"]) assert.equal(endOfDay(bad), null, bad);
});

test("تاريخ نهاية الباقة: الفصل من الإعدادات، والسنة = نهاية الفصل الثالث، والدورة سنة من اليوم", () => {
  const settings = { term1_end: "2027-01-20", term2_end: "2027-03-20", term3_end: "2027-06-30" };
  assert.deepEqual(computeEnd("term1", settings, NOW), { ok: true, endsAt: endOfDay("2027-01-20") });
  assert.deepEqual(computeEnd("term2", settings, NOW), { ok: true, endsAt: endOfDay("2027-03-20") });
  assert.deepEqual(computeEnd("year", settings, NOW), { ok: true, endsAt: endOfDay("2027-06-30") });
  assert.deepEqual(computeEnd("course", {}, NOW), { ok: true, endsAt: NOW + COURSE_MS });
  const missing = computeEnd("term3", {}, NOW);
  assert.equal(missing.ok, false);
  const past = computeEnd("term1", { term1_end: "2026-12-17" }, NOW);
  assert.ok(!past.ok && /انتهى/.test(past.error));
});

test("قاعدة الفتح: الساري يفتح الكل، وبعد الانتهاء يبقى القديم سنة ويُقفل الجديد", () => {
  const end = NOW + 10 * DAY;
  const sub = { program_slug: "2am", starts_at: NOW - 30 * DAY, ends_at: end };
  const at = (now: number): Access => ({ all: false, subs: [sub], now });
  const old = { free: 0, program_slug: "2am", visible_since: NOW - 100 * DAY };
  const later = { free: 0, program_slug: "2am", visible_since: end + DAY };
  // ساري: كل شيء، حتى ما سيُنشر لاحقًا
  assert.ok(canOpen(at(NOW), old));
  assert.ok(canOpen(at(NOW), { ...later, visible_since: NOW }));
  // بعد الانتهاء بشهر: القديم مفتوح، والجديد مقفل
  assert.ok(canOpen(at(end + 30 * DAY), old));
  assert.ok(!canOpen(at(end + 30 * DAY), later));
  // ما نُشر يوم الانتهاء نفسه قديم
  assert.ok(canOpen(at(end + 30 * DAY), { ...old, visible_since: end }));
  // بعد سنة من الانتهاء: كل شيء مقفل
  assert.ok(canOpen(at(end + GRACE_MS), old));
  assert.ok(!canOpen(at(end + GRACE_MS + 1), old));
  // مستوى آخر: مقفل. المجاني: مفتوح للجميع. الأستاذ: كل شيء
  assert.ok(!canOpen(at(NOW), { ...old, program_slug: "3am" }));
  assert.ok(canOpen({ all: false, subs: [], now: NOW }, { ...old, free: 1 }));
  assert.ok(canOpen({ all: true, subs: [], now: NOW }, later));
  // اشتراك يبدأ في المستقبل لا يفتح الآن
  assert.ok(!canOpen({ all: false, subs: [{ ...sub, starts_at: NOW + DAY }], now: NOW }, { ...old, visible_since: NOW + 2 * DAY }));
});

test("حالة الاشتراك: غير مشترك، ساري، حان وقت الدفع قبل 14 يومًا، منتهي، وآخر اشتراك هو المعتبر", () => {
  const sub = (id: number, starts: number, ends: number, kind: Subscription["kind"] = "term1"): Subscription => ({
    id,
    student_id: 1,
    program_slug: "2am",
    kind,
    starts_at: starts,
    ends_at: ends,
    note: null,
    created_by: null,
    created_at: starts,
    payment_id: null,
    amount: null,
    pay_due_at: null,
  });
  assert.equal(subscriptionStatus([], "2am", NOW).state, "none");
  assert.equal(subscriptionStatus([sub(1, NOW - DAY, NOW + 30 * DAY)], "2am", NOW).state, "active");
  assert.equal(subscriptionStatus([sub(1, NOW - DAY, NOW + 14 * DAY)], "2am", NOW).state, "due");
  assert.equal(subscriptionStatus([sub(1, NOW - DAY, NOW + 15 * DAY)], "2am", NOW).state, "active");
  assert.equal(subscriptionStatus([sub(1, NOW - 90 * DAY, NOW - DAY)], "2am", NOW).state, "expired");
  // تجديد: المنتهي القديم لا يهم
  const renewed = subscriptionStatus([sub(1, NOW - 90 * DAY, NOW - DAY), sub(2, NOW, NOW + 60 * DAY, "term2")], "2am", NOW);
  assert.equal(renewed.state, "active");
  assert.equal(renewed.latest?.id, 2);
  assert.equal(subscriptionStatus([sub(1, NOW - DAY, NOW + 30 * DAY)], "3am", NOW).state, "none");
  // غير مدفوع: ساري في المهلة مع التنبيه، ومتوقف بعدها
  const unpaid = { ...sub(3, NOW - 2 * DAY, NOW + 60 * DAY), pay_due_at: NOW + 13 * DAY };
  const inGrace = subscriptionStatus([unpaid], "2am", NOW);
  assert.equal(inGrace.state, "active");
  assert.equal(inGrace.payDue, NOW + 13 * DAY);
  assert.equal(subscriptionStatus([{ ...unpaid, pay_due_at: NOW - 1 }], "2am", NOW).state, "suspended");
  assert.equal(subscriptionStatus([{ ...unpaid, pay_due_at: NOW - 1, payment_id: 9 }], "2am", NOW).state, "active");
});

// ---------- على الخادم ----------

/** محتوى منشور في 2 متوسط: درس مدفوع قديم، ودورة فيها درس. */
function seed(env: TestEnv, publishedAt = Date.now() - 30 * DAY) {
  env.DB.raw.exec(`
    INSERT INTO units (id, program_slug, title, position, status, published_at, created_at, updated_at) VALUES
      (10, '2am', 'مقطع 2 متوسط', 1, 'published', ${publishedAt}, ${publishedAt}, ${publishedAt}),
      (20, 'olympiad', 'جزء الأولمبياد', 1, 'published', ${publishedAt}, ${publishedAt}, ${publishedAt});
    INSERT INTO lessons (id, unit_id, kind, title, position, free, status, youtube_id, published_at, created_at, updated_at) VALUES
      (100, 10, 'video', 'درس 2 متوسط المدفوع', 1, 0, 'published', 'PAID2am0001', ${publishedAt}, ${publishedAt}, ${publishedAt}),
      (200, 20, 'video', 'درس الأولمبياد', 1, 0, 'published', 'PAIDolymp02', ${publishedAt}, ${publishedAt}, ${publishedAt});
  `);
}

async function setTerms(admin: Browser, extra: Record<string, string> = {}) {
  return admin.post("/admin/settings", {
    term1_end: isoIn(40),
    term2_end: isoIn(130),
    term3_end: isoIn(220),
    price_term: "2500 دج",
    price_year: "6000 دج",
    price_course: "4000 دج",
    whatsapp: "0555 12 34 56",
    payment_info: "CCP: 0000000 مفتاح 00\nباسم الأستاذ",
    ...extra,
  });
}

/** عائلة جاهزة بابنين (ياسين 2 متوسط، مريم 4 متوسط) دخلت وغيّرت كلمة المرور. */
async function family(env: TestEnv, admin: Browser) {
  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  await parent.post("/login", { phone: "0661223344", password: password ?? "" });
  await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  const id = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
  const kids = env.DB.raw.prepare("SELECT id FROM students WHERE account_id = ? ORDER BY id").all(id) as { id: number }[];
  return { parent, id, yacine: kids[0]!.id, maryam: kids[1]!.id };
}

test("الإعدادات: تُحفظ وتظهر في صفحة الاشتراك، والأخطاء تُرفض", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const bad = await setTerms(admin, { term2_end: isoIn(10), whatsapp: "123" });
  assert.equal(bad.status, 400);
  const text = await bad.text();
  assert.match(text, /بعد نهاية الفصل الأول/);
  assert.match(text, /رقم الهاتف غير صحيح/);
  assert.equal((await setTerms(admin)).headers.get("Location"), "/admin/settings?done=1");

  const page = await (await new Browser(env).get("/subscribe")).text();
  assert.match(page, /2500 دج/);
  assert.match(page, /6000 دج/);
  assert.match(page, /CCP: 0000000/);
  assert.match(page, /https:\/\/wa\.me\/213555123456\?text=/);
  // الإعدادات للأستاذ فقط
  assert.match((await new Browser(env).get("/admin/settings")).headers.get("Location") ?? "", /^\/login/);
});

test("تفعيل باقة الفصل: يفتح المحتوى للابن ولوليه، ولا يفتحه لأخيه أو لعائلة أخرى", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  const { parent, id, yacine, maryam } = await family(env, admin);

  // بدون تواريخ الفصول: رسالة واضحة
  const noTerms = await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:term1", amount: "3000", receipt: "وصل 12" });
  assert.equal(noTerms.status, 400);
  assert.match(await noTerms.text(), /تواريخ نهاية الفصول/);

  await setTerms(admin);
  const ok = await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:term1", amount: "3000", receipt: "وصل 12" });
  assert.equal(ok.headers.get("Location"), `/admin/families/${id}?done=sub-activated#subs`);
  const famPage = await (await admin.get(`/admin/families/${id}`)).text();
  assert.match(famPage, /مشترك حتى/);
  assert.match(famPage, /مدفوع · 3[  ]000 دج/);
  assert.match(famPage, /وصل <bdi>وصل 12<\/bdi>/);

  // ياسين يفتح الدرس المدفوع
  await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) });
  assert.match(await (await parent.get("/lessons/100")).text(), /embed\/PAID2am0001/);
  // الولي يراه أيضًا من ملفه
  await parent.post("/profiles/select", { kind: "parent" });
  assert.equal((await parent.get("/lessons/100")).status, 200);
  // مريم لا تراه، ولا الأولمبياد
  await parent.post("/profiles/select", { kind: "student", student_id: String(maryam) });
  assert.equal((await parent.get("/lessons/100")).status, 302);
  assert.equal((await parent.get("/lessons/200")).status, 302);
  // قبل اختيار الملف: لا شيء
  const fresh = new Browser(env);
  assert.equal((await fresh.get("/lessons/100")).status, 302);

  // باقة غير صالحة لهذا الابن تُرفض
  assert.equal((await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "olympiad:term1", amount: "3000", receipt: "وصل 12" })).status, 400);
  assert.equal((await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "", amount: "3000", receipt: "وصل 12" })).status, 400);
});

test("الدورة: سنة من التفعيل، وتختفي من التوصيات بعد الاشتراك", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin);
  const { parent, maryam } = await family(env, admin);
  await parent.post("/profiles/select", { kind: "parent" });
  let page = await (await parent.get("/account")).text();
  assert.match(page, /دورات ننصح بها/);
  assert.match(page, /تحضير الأولمبياد/);
  assert.match(page, /wa\.me\/213555123456\?text=[^"]*%D8%A3%D9%88%D9%84%D9%85%D8%A8%D9%8A%D8%A7%D8%AF/);
  // الدورة بلا دروس منشورة لا تُقترح
  assert.doesNotMatch(page, /الحساب الذهني/);

  await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${maryam}`]: "olympiad:course", amount: "3000", receipt: "وصل 12" });
  const sub = env.DB.raw.prepare("SELECT starts_at, ends_at FROM subscriptions WHERE student_id = ?").get(maryam) as { starts_at: number; ends_at: number };
  assert.equal(sub.ends_at - sub.starts_at, COURSE_MS);
  page = await (await parent.get("/account")).text();
  assert.doesNotMatch(page, /دورات ننصح بها/);
  await parent.post("/profiles/select", { kind: "student", student_id: String(maryam) });
  assert.equal((await parent.get("/lessons/200")).status, 200);
});

test("بعد انتهاء الاشتراك: الدرس القديم مفتوح، والدرس المنشور بعد الانتهاء مقفل", async () => {
  const env = makeEnv();
  const longAgo = Date.now() - 200 * DAY;
  seed(env, longAgo);
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin);
  const { parent, yacine } = await family(env, admin);
  await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:term1", amount: "3000", receipt: "وصل 12" });
  // نُرجع الاشتراك إلى الماضي: انتهى قبل 30 يومًا
  const ended = Date.now() - 30 * DAY;
  env.DB.raw.prepare("UPDATE subscriptions SET starts_at = ?, ends_at = ? WHERE student_id = ?").run(ended - 90 * DAY, ended, yacine);
  // درس جديد نُشر بعد الانتهاء
  env.DB.raw.exec(`INSERT INTO lessons (id, unit_id, kind, title, position, free, status, youtube_id, published_at, created_at, updated_at)
    VALUES (101, 10, 'video', 'درس جديد', 2, 0, 'published', 'NEW2am00002', ${Date.now() - DAY}, 0, 0)`);

  await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) });
  assert.equal((await parent.get("/lessons/100")).status, 200);
  assert.equal((await parent.get("/lessons/101")).status, 302);
  const level = await (await parent.get("/levels/2am")).text();
  assert.match(level, /href="\/lessons\/100"/);
  assert.match(level, /href="\/subscribe\?lesson=101"/);
  assert.match(await (await parent.get("/home")).text(), /انتهى في/);

  // بعد سنة من الانتهاء: يُقفل القديم أيضًا
  env.DB.raw.prepare("UPDATE subscriptions SET starts_at = ?, ends_at = ? WHERE student_id = ?").run(Date.now() - GRACE_MS - 90 * DAY, Date.now() - GRACE_MS - DAY, yacine);
  assert.equal((await parent.get("/lessons/100")).status, 302);
});

test("حان وقت الدفع قبل 14 يومًا، والاشتراك يظهر في لوحة التحكم قبل 7 أيام ويختفي بعد التجديد", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin, { term1_end: isoIn(5) });
  const { parent, yacine } = await family(env, admin);
  await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:term1", amount: "3000", receipt: "وصل 12" });

  await parent.post("/profiles/select", { kind: "parent" });
  const page = await (await parent.get("/account")).text();
  assert.match(page, /حان وقت دفع الفصل التالي/);
  assert.match(page, /جدّد عبر واتساب/);
  // مريم غير مشتركة
  assert.match(page, /غير مشترك/);
  assert.match(page, /اشترك عبر واتساب/);

  let dash = await (await admin.get("/admin")).text();
  assert.match(dash, /اشتراكات تنتهي خلال 7 أيام/);
  assert.match(dash, /ياسين بن علي/);

  await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:term2", amount: "3000", receipt: "وصل 12" });
  dash = await (await admin.get("/admin")).text();
  assert.doesNotMatch(dash, /اشتراكات تنتهي خلال 7 أيام/);
});

test("حذف اشتراك (للأخطاء) يحتاج تأكيدًا، ويُقفل المحتوى بعده", async () => {
  const env = makeEnv();
  seed(env);
  const { b: admin } = await setupAdmin(env);
  await setTerms(admin);
  const { parent, id, yacine } = await family(env, admin);
  await admin.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:year", amount: "3000", receipt: "وصل 12" });
  const subId = Number(env.DB.raw.prepare("SELECT id FROM subscriptions WHERE student_id = ?").get(yacine)?.id);
  await admin.post(`/admin/subscriptions/${subId}/delete`, {});
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM subscriptions").get()?.n, 1);
  assert.equal((await admin.post(`/admin/subscriptions/${subId}/delete`, { confirm: "1" })).headers.get("Location"), `/admin/families/${id}?done=sub-deleted#subs`);
  await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) });
  assert.equal((await parent.get("/lessons/100")).status, 302);
  // الولي لا يستطيع تفعيل اشتراك بنفسه
  assert.equal((await parent.post(`/admin/families/${famOf(env)}/activate`, { [`package_${yacine}`]: "2am:year", amount: "3000", receipt: "وصل 12" })).status, 404);
});

test("نشر الدرس يسجل أول تاريخ نشر ولا يغيّره عند الإخفاء وإعادة النشر", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  env.DB.raw.exec(`INSERT INTO units (id, program_slug, title, position, status, created_at, updated_at) VALUES (30, '1am', 'مقطع', 1, 'draft', 0, 0);
    INSERT INTO lessons (id, unit_id, kind, title, position, free, status, youtube_id, created_at, updated_at) VALUES (300, 30, 'video', 'درس', 1, 0, 'draft', 'pubTIME0001', 0, 0);`);
  await admin.post("/admin/lessons/300/status", {});
  await admin.post("/admin/units/30/status", {});
  const first = env.DB.raw.prepare("SELECT published_at FROM lessons WHERE id = 300").get()?.published_at;
  assert.ok(Number(first) > 0);
  assert.ok(Number(env.DB.raw.prepare("SELECT published_at FROM units WHERE id = 30").get()?.published_at) > 0);
  await admin.post("/admin/lessons/300/status", {});
  await admin.post("/admin/lessons/300/status", {});
  assert.equal(env.DB.raw.prepare("SELECT published_at FROM lessons WHERE id = 300").get()?.published_at, first);
});
