// اختبارات المرحلة 3: أجهزة العائلة، وملفات الأبناء، والرمز السري لكل ملف.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Browser, FAMILY, createFamily, makeEnv, setupAdmin, type TestEnv } from "./helpers/family.ts";

const PHONE = "0661223344";
const PASSWORD = "Nouvelle-2026";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1";

/** عائلة جاهزة: أنشأها الأستاذ، ودخل الولي من أول جهاز وغيّر كلمة المرور. */
async function readyFamily(env: TestEnv) {
  const { b: admin } = await setupAdmin(env);
  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  await parent.post("/login", { phone: PHONE, password: password ?? "" });
  await parent.post("/account/password", { password: PASSWORD, confirm: PASSWORD });
  const id = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = ?").get(PHONE)?.id);
  const kids = env.DB.raw.prepare("SELECT id, name FROM students WHERE account_id = ? ORDER BY id").all(id) as { id: number; name: string }[];
  return { admin, parent, id, yacine: Number(kids[0]?.id), maryam: Number(kids[1]?.id) };
}

function deviceRows(env: TestEnv, accountId: number) {
  return env.DB.raw.prepare("SELECT id, status, label FROM devices WHERE account_id = ? ORDER BY id").all(accountId) as {
    id: number;
    status: string;
    label: string;
  }[];
}

// ---------- الأجهزة ----------

test("أول جهاز للعائلة يُعتمد تلقائيًا، والثاني ينتظر موافقة الأستاذ", async () => {
  const env = makeEnv();
  const { admin, id } = await readyFamily(env);
  assert.deepEqual(deviceRows(env, id).map((d) => d.status), ["approved"]);

  const phone2 = new Browser(env, IPHONE);
  const login = await phone2.post("/login", { phone: PHONE, password: PASSWORD });
  assert.equal(login.headers.get("Location"), "/login/device");
  const wait = await phone2.get("/login/device");
  assert.equal(wait.status, 200);
  assert.match(await wait.text(), /جهاز جديد بانتظار الموافقة/);
  // قبل الموافقة: لا وصول لأي صفحة في الحساب
  for (const path of ["/profiles", "/account", "/home"]) {
    assert.match((await phone2.get(path)).headers.get("Location") ?? "", /^\/login/, path);
  }
  const rows = deviceRows(env, id);
  assert.deepEqual(rows.map((d) => d.status), ["approved", "pending"]);
  assert.equal(rows[1]?.label, "iPhone، Safari");

  // الأستاذ يرى الطلب في لوحة التحكم ويوافق
  const dash = await (await admin.get("/admin")).text();
  assert.match(dash, /أجهزة بانتظار موافقتك/);
  assert.match(dash, /iPhone، Safari/);
  const approve = await admin.post(`/admin/devices/${rows[1]?.id}/approve`, { back: "dashboard" });
  assert.equal(approve.headers.get("Location"), "/admin");
  assert.doesNotMatch(await (await admin.get("/admin")).text(), /أجهزة بانتظار موافقتك/);

  // «تحقق الآن» يحوّل الجلسة إلى جلسة كاملة
  assert.equal((await phone2.get("/login/device")).headers.get("Location"), "/profiles");
  assert.equal((await phone2.get("/profiles")).status, 200);
});

test("رفض الجهاز أو إزالته يُخرجه فورًا، وإذا دخل منه مجددًا ينتظر الموافقة", async () => {
  const env = makeEnv();
  const { admin, parent, id } = await readyFamily(env);
  const phone2 = new Browser(env, IPHONE);
  await phone2.post("/login", { phone: PHONE, password: PASSWORD });
  const pending = deviceRows(env, id)[1]!;

  // رفض الطلب: يرجع إلى صفحة الدخول
  assert.equal((await admin.post(`/admin/devices/${pending.id}/remove`, { back: "family" })).headers.get("Location"), `/admin/families/${id}?done=device-removed`);
  assert.equal((await phone2.get("/login/device")).headers.get("Location"), "/login");

  // إزالة الجهاز الأول المعتمد: الولي يخرج فورًا
  const first = deviceRows(env, id)[0]!;
  assert.equal((await parent.get("/profiles")).status, 200);
  await admin.post(`/admin/devices/${first.id}/remove`, { back: "family" });
  assert.match((await parent.get("/profiles")).headers.get("Location") ?? "", /^\/login/);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?").get(id)?.n, 0);
  // لم يبقَ أي جهاز للعائلة، فأول دخول بعدها يُعتمد تلقائيًا
  assert.equal((await parent.post("/login", { phone: PHONE, password: PASSWORD })).headers.get("Location"), "/profiles");
  // والآن الهاتف الثاني ينتظر من جديد
  assert.equal((await phone2.post("/login", { phone: PHONE, password: PASSWORD })).headers.get("Location"), "/login/device");
});

test("إعادة ضبط الأجهزة تُخرج الجميع، وأول جهاز بعدها يُعتمد تلقائيًا", async () => {
  const env = makeEnv();
  const { admin, parent, id } = await readyFamily(env);
  const phone2 = new Browser(env, IPHONE);
  await phone2.post("/login", { phone: PHONE, password: PASSWORD });
  assert.equal(deviceRows(env, id).length, 2);

  const page = await (await admin.get(`/admin/families/${id}`)).text();
  assert.match(page, /إعادة ضبط الأجهزة/);
  assert.match(page, /بانتظار موافقتك/);
  assert.equal((await admin.post(`/admin/families/${id}/reset-devices`, {})).headers.get("Location"), `/admin/families/${id}?done=devices-reset`);
  assert.equal(deviceRows(env, id).length, 0);
  assert.match((await parent.get("/profiles")).headers.get("Location") ?? "", /^\/login/);

  // الولي غيّر هاتفه: الهاتف الجديد يدخل مباشرة
  assert.equal((await phone2.post("/login", { phone: PHONE, password: PASSWORD })).headers.get("Location"), "/profiles");
  assert.deepEqual(deviceRows(env, id).map((d) => d.status), ["approved"]);
});

test("الجهاز يخص الحساب: نفس المتصفح لحساب آخر جهاز جديد", async () => {
  const env = makeEnv();
  const { admin } = await readyFamily(env);
  const other = await createFamily(admin, { ...FAMILY, phone: "0770112233", child_name_1: "سارة", child_name_2: "", child_level_2: "" });
  // متصفح الأستاذ (فيه كعكة جهاز الأستاذ) يدخل بحساب عائلة جديدة: أول جهاز لها، فيُعتمد
  const login = await admin.post("/login", { phone: "0770112233", password: other.password ?? "" });
  assert.equal(login.headers.get("Location"), "/account/password");
  const otherId = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0770112233'").get()?.id);
  assert.deepEqual(deviceRows(env, otherId).map((d) => d.status), ["approved"]);
});

test("جهاز الأستاذ المعتمد يبقى يعمل دون الرمز ذي الأرقام الستة", async () => {
  const env = makeEnv();
  const { admin } = await readyFamily(env);
  await admin.post("/logout", {});
  const again = await admin.post("/login", { phone: "0555000111", password: "Admin-Pass-2026" });
  assert.equal(again.headers.get("Location"), "/admin");
  assert.equal((await admin.get("/admin")).status, 200);
  // الأستاذ لا يملك صفحات العائلة
  assert.equal((await admin.get("/profiles")).headers.get("Location"), "/admin");
});

// ---------- الملفات ----------

test("اختيار الملف: الابن يرى صفحته واسمه، ولا يرى صفحة الولي", async () => {
  const env = makeEnv();
  const { parent, yacine } = await readyFamily(env);
  const list = await (await parent.get("/profiles")).text();
  assert.match(list, /ياسين بن علي/);
  assert.match(list, /مريم بن علي/);
  assert.match(list, /الولي/);

  assert.equal((await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) })).headers.get("Location"), "/home");
  const home = await (await parent.get("/home")).text();
  assert.match(home, /<h1>ياسين بن علي<\/h1>/);
  assert.match(home, /href="\/levels\/2am"/);
  assert.match(home, /drawer-switch/);
  // صفحة الولي وكلمة مرور العائلة ليستا للابن
  assert.equal((await parent.get("/account")).headers.get("Location"), "/home");
  assert.equal((await parent.get("/account/pins")).headers.get("Location"), "/home");
  assert.equal((await parent.get("/account/password")).headers.get("Location"), "/home");
});

test("لا يمكن اختيار ابن من عائلة أخرى أو ابن موقوف", async () => {
  const env = makeEnv();
  const { admin, parent, yacine } = await readyFamily(env);
  await createFamily(admin, { ...FAMILY, phone: "0770112233", child_name_1: "سارة", child_name_2: "", child_level_2: "" });
  const sara = Number(env.DB.raw.prepare("SELECT id FROM students WHERE name = 'سارة'").get()?.id);
  assert.equal((await parent.post("/profiles/select", { kind: "student", student_id: String(sara) })).headers.get("Location"), "/profiles");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE student_id = ?").get(sara)?.n, 0);

  // الابن المختار يُوقف: يرجع إلى اختيار الملف
  await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) });
  await admin.post(`/admin/students/${yacine}/edit`, { name: "ياسين بن علي", level: "2am", status: "disabled" });
  assert.equal((await parent.get("/home")).headers.get("Location"), "/profiles");
  assert.doesNotMatch(await (await parent.get("/profiles")).text(), /ياسين بن علي/);
});

test("الرمز السري: يُطلب لملف الابن، والولي يدخل إلى ملف ابنه دون رمز", async () => {
  const env = makeEnv();
  const { parent, yacine, maryam } = await readyFamily(env);
  await parent.post("/profiles/select", { kind: "parent" });

  // رموز ضعيفة أو غير متطابقة تُرفض
  assert.match(await (await parent.post("/account/pins", { target: `s${yacine}`, action: "set", pin: "12", confirm: "12" })).text(), /4 أرقام بالضبط/);
  assert.match(await (await parent.post("/account/pins", { target: `s${yacine}`, action: "set", pin: "1111", confirm: "1111" })).text(), /سهل التخمين/);
  assert.match(await (await parent.post("/account/pins", { target: `s${yacine}`, action: "set", pin: "4826", confirm: "4827" })).text(), /غير متطابقين/);
  const set = await parent.post("/account/pins", { target: `s${yacine}`, action: "set", pin: "4826", confirm: "4826" });
  assert.equal(set.headers.get("Location"), "/account/pins?done=set");
  const stored = String(env.DB.raw.prepare("SELECT pin_hash FROM students WHERE id = ?").get(yacine)?.pin_hash);
  assert.match(stored, /^pbkdf2-sha256\$/);
  assert.ok(!stored.includes("4826"));

  // من ملف الولي: الدخول إلى ملف ياسين مباشرة
  assert.equal((await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) })).headers.get("Location"), "/home");
  // من ملف ياسين إلى ملف مريم (بلا رمز): مباشرة. ومن ملف مريم إلى ياسين: يُطلب الرمز
  assert.equal((await parent.post("/profiles/select", { kind: "student", student_id: String(maryam) })).headers.get("Location"), "/home");
  const ask = await parent.post("/profiles/select", { kind: "student", student_id: String(yacine) });
  assert.equal(ask.headers.get("Location"), `/profiles/unlock?kind=student&id=${yacine}`);
  assert.match(await (await parent.get(ask.headers.get("Location") ?? "")).text(), /محمي برمز من 4 أرقام/);
  assert.equal((await parent.post("/profiles/unlock", { kind: "student", student_id: String(yacine), pin: "0000" })).status, 400);
  assert.match(await (await parent.get("/home")).text(), /مريم بن علي/);
  assert.equal((await parent.post("/profiles/unlock", { kind: "student", student_id: String(yacine), pin: "4826" })).headers.get("Location"), "/home");
  assert.match(await (await parent.get("/home")).text(), /<h1>ياسين بن علي<\/h1>/);
});

test("رمز ملف الولي يمنع الابن من فتح ملف الولي، و5 أخطاء تقفل الملف 15 دقيقة", async () => {
  const env = makeEnv();
  const { parent, id, maryam } = await readyFamily(env);
  await parent.post("/profiles/select", { kind: "parent" });
  await parent.post("/account/pins", { target: "parent", action: "set", pin: "7391", confirm: "7391" });
  await parent.post("/profiles/select", { kind: "student", student_id: String(maryam) });

  assert.equal((await parent.post("/profiles/select", { kind: "parent" })).headers.get("Location"), "/profiles/unlock?kind=parent");
  for (let i = 1; i <= 4; i++) {
    const r = await parent.post("/profiles/unlock", { kind: "parent", pin: "1590" });
    assert.equal(r.status, 400, `المحاولة ${i}`);
  }
  const fifth = await parent.post("/profiles/unlock", { kind: "parent", pin: "1590" });
  assert.equal(fifth.status, 429);
  assert.match(await fifth.text(), /أُوقف هذا الملف مؤقتًا/);
  // حتى الرمز الصحيح يُرفض أثناء القفل
  assert.equal((await parent.post("/profiles/unlock", { kind: "parent", pin: "7391" })).status, 429);
  assert.equal((await parent.get("/account")).headers.get("Location"), "/home");

  // بعد انتهاء القفل يعمل الرمز الصحيح
  env.DB.raw.prepare("UPDATE accounts SET parent_pin_locked_until = ? WHERE id = ?").run(Date.now() - 1, id);
  assert.equal((await parent.post("/profiles/unlock", { kind: "parent", pin: "7391" })).headers.get("Location"), "/account");
  assert.equal((await parent.get("/account")).status, 200);
});

test("الأستاذ يمسح الرموز إذا نسيتها العائلة، والولي يستطيع إزالة رمز", async () => {
  const env = makeEnv();
  const { admin, parent, id, yacine } = await readyFamily(env);
  await parent.post("/profiles/select", { kind: "parent" });
  await parent.post("/account/pins", { target: "parent", action: "set", pin: "7391", confirm: "7391" });
  await parent.post("/account/pins", { target: `s${yacine}`, action: "set", pin: "4826", confirm: "4826" });

  // الولي يزيل رمز ياسين بنفسه
  assert.equal((await parent.post("/account/pins", { target: `s${yacine}`, action: "clear" })).headers.get("Location"), "/account/pins?done=cleared");
  assert.equal(env.DB.raw.prepare("SELECT pin_hash FROM students WHERE id = ?").get(yacine)?.pin_hash, null);

  const famPage = await (await admin.get(`/admin/families/${id}`)).text();
  assert.match(famPage, /مسح رموز الملفات/);
  assert.equal((await admin.post(`/admin/families/${id}/clear-pins`, {})).headers.get("Location"), `/admin/families/${id}?done=pins-cleared`);
  assert.equal(env.DB.raw.prepare("SELECT parent_pin_hash FROM accounts WHERE id = ?").get(id)?.parent_pin_hash, null);
  assert.doesNotMatch(await (await admin.get(`/admin/families/${id}`)).text(), /مسح رموز الملفات/);
});

test("صفحة الولي تعرض الأبناء والأجهزة، وزر الدخول إلى ملف كل ابن", async () => {
  const env = makeEnv();
  const { parent, yacine } = await readyFamily(env);
  await new Browser(env, IPHONE).post("/login", { phone: PHONE, password: PASSWORD });
  await parent.post("/profiles/select", { kind: "parent" });
  const page = await (await parent.get("/account")).text();
  assert.match(page, /ياسين بن علي/);
  assert.match(page, /السنة الرابعة متوسط/);
  assert.match(page, new RegExp(`name="student_id" value="${yacine}"`));
  assert.match(page, /Android، Chrome/);
  assert.match(page, /بانتظار الأستاذ/);
  assert.match(page, /حساب العائلة/);
});

test("الصفحات الجديدة محمية: الزائر يُحوَّل إلى الدخول، والنموذج من خارج الموقع مرفوض", async () => {
  const env = makeEnv();
  const { parent } = await readyFamily(env);
  const visitor = new Browser(env);
  for (const path of ["/profiles", "/home", "/account", "/account/pins", "/profiles/unlock?kind=parent"]) {
    assert.match((await visitor.get(path)).headers.get("Location") ?? "", /^\/login\?next=/, path);
  }
  const forged = await parent.request("/profiles/select", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" },
    body: "kind=parent",
  });
  assert.equal(forged.status, 403);
});
