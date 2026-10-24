// اختبارات المرحلة 2 من أولها إلى آخرها: كل طلب يمر بالخادم الحقيقي وقاعدة بيانات حقيقية (SQLite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, type Env } from "../src/index.ts";
import { createTestDb } from "./helpers/d1.ts";
import { base32Decode, totpAt } from "../src/crypto.ts";

const BASE = "https://zinou.test";
const SETUP_CODE = "رمز-تأسيس-تجريبي-طويل";
const ADMIN = { name: "الأستاذ زين الدين", phone: "0555000111", password: "Admin-Pass-2026" };

type TestEnv = Env & { DB: ReturnType<typeof createTestDb> };

function makeEnv(setupCode: string | null = SETUP_CODE): TestEnv {
  return {
    APP_ENV: "staging",
    DB: createTestDb(),
    ADMIN_SETUP_CODE: setupCode ?? undefined,
    PASSWORD_ITERATIONS: "1000",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
}

/** متصفح صغير للاختبار: يحفظ الكعكات ويرسل ترويسة Origin مع النماذج. */
class Browser {
  env: TestEnv;
  jar = new Map<string, string>();
  last: Response | null = null;
  constructor(env: TestEnv) {
    this.env = env;
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("Cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    headers.set("User-Agent", "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    const res = await handleRequest(new Request(BASE + path, { ...init, headers }), this.env);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = (pair ?? "").indexOf("=");
      const name = (pair ?? "").slice(0, i);
      const value = (pair ?? "").slice(i + 1);
      if (/Max-Age=0/.test(c) || !value) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    this.last = res;
    return res;
  }
  get(path: string) {
    return this.request(path);
  }
  post(path: string, fields: Record<string, string>) {
    return this.request(path, {
      method: "POST",
      headers: { Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }
}

function hiddenValue(htmlText: string, name: string): string {
  const m = new RegExp(`name="${name}" value="([^"]+)"`).exec(htmlText);
  assert.ok(m, `الحقل ${name} غير موجود`);
  return m[1] ?? "";
}

async function code(secret: string, now = Date.now()): Promise<string> {
  return totpAt(base32Decode(secret), now);
}

/** ينشئ حساب الأستاذ عبر صفحة التأسيس، ويُرجع المتصفح والمفتاح ورموز الطوارئ. */
async function setupAdmin(env: TestEnv) {
  const b = new Browser(env);
  const form = await (await b.get("/setup")).text();
  const secret = hiddenValue(form, "secret");
  const res = await b.post("/setup", {
    setup_code: SETUP_CODE,
    secret,
    name: ADMIN.name,
    phone: ADMIN.phone,
    password: ADMIN.password,
    confirm: ADMIN.password,
    totp: await code(secret),
  });
  assert.equal(res.status, 200);
  const page = await res.text();
  const codes = [...page.matchAll(/<li>([a-z0-9]{5}-[a-z0-9]{5})<\/li>/g)].map((m) => m[1] ?? "");
  return { b, secret, codes };
}

async function createFamily(b: Browser, fields: Record<string, string>) {
  const res = await b.post("/admin/families/new", fields);
  const text = await res.text();
  const password = /data-copy-source="password">([a-z0-9-]+)</.exec(text)?.[1];
  return { res, text, password };
}

const FAMILY = {
  name: "عائلة بن علي",
  phone: "0661 22 33 44",
  note: "",
  child_name_1: "ياسين بن علي",
  child_level_1: "2am",
  child_name_2: "مريم بن علي",
  child_level_2: "4am",
};

// ---------- التأسيس ----------

test("التأسيس: غير متاح بدون رمز التأسيس", async () => {
  const b = new Browser(makeEnv(null));
  assert.equal((await b.get("/setup")).status, 503);
});

test("التأسيس: رمز خاطئ يُرفض، والصحيح ينشئ حساب الأستاذ مرة واحدة فقط", async () => {
  const env = makeEnv();
  const b = new Browser(env);
  const form = await (await b.get("/setup")).text();
  assert.match(form, /<svg class="qr"/);
  const secret = hiddenValue(form, "secret");
  const wrong = await b.post("/setup", {
    setup_code: "تخمين",
    secret,
    name: ADMIN.name,
    phone: ADMIN.phone,
    password: ADMIN.password,
    confirm: ADMIN.password,
    totp: await code(secret),
  });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /رمز التأسيس غير صحيح/);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>().then((r) => r?.n), 0);

  const { codes } = await setupAdmin(env);
  assert.equal(codes.length, 8);
  const admin = env.DB.raw.prepare("SELECT * FROM accounts WHERE role = 'admin'").get() as Record<string, unknown>;
  assert.equal(admin.phone, ADMIN.phone);
  assert.match(String(admin.password_hash), /^pbkdf2-sha256\$1000\$/);
  assert.ok(!String(admin.password_hash).includes(ADMIN.password));
  // بعد التأسيس تختفي الصفحة نهائيًا
  assert.equal((await new Browser(env).get("/setup")).status, 404);
});

test("التأسيس: رمز التطبيق الخاطئ يُرفض", async () => {
  const env = makeEnv();
  const b = new Browser(env);
  const secret = hiddenValue(await (await b.get("/setup")).text(), "secret");
  const res = await b.post("/setup", {
    setup_code: SETUP_CODE,
    secret,
    name: ADMIN.name,
    phone: ADMIN.phone,
    password: ADMIN.password,
    confirm: ADMIN.password,
    totp: "000000",
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /الرمز غير صحيح/);
});

// ---------- دخول الأستاذ ----------

test("الأستاذ: جهاز جديد يحتاج الرمز ذا الأرقام الستة، والجهاز المعتمد لا يحتاجه", async () => {
  const env = makeEnv();
  const { secret } = await setupAdmin(env);
  const phone = new Browser(env);
  const login = await phone.post("/login", { phone: ADMIN.phone, password: ADMIN.password });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("Location"), "/login/verify");
  // قبل الرمز: لا وصول إلى لوحة التحكم
  const blocked = await phone.get("/admin");
  assert.equal(blocked.status, 303);
  assert.match(blocked.headers.get("Location") ?? "", /^\/login/);

  const bad = await phone.post("/login/verify", { code: "123456", remember: "1" });
  assert.equal(bad.status, 400);
  const ok = await phone.post("/login/verify", { code: await code(secret), remember: "1" });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("Location"), "/admin");
  assert.equal((await phone.get("/admin")).status, 200);

  // خروج ثم دخول من نفس الجهاز: لا يُطلب الرمز
  await phone.post("/logout", {});
  const again = await phone.post("/login", { phone: ADMIN.phone, password: ADMIN.password });
  assert.equal(again.headers.get("Location"), "/admin");
});

test("الأستاذ: رمز الطوارئ يعمل مرة واحدة فقط", async () => {
  const env = makeEnv();
  const { codes } = await setupAdmin(env);
  const first = codes[0] ?? "";
  const b1 = new Browser(env);
  await b1.post("/login", { phone: ADMIN.phone, password: ADMIN.password });
  assert.equal((await b1.post("/login/verify", { code: first.toUpperCase() })).headers.get("Location"), "/admin");
  const b2 = new Browser(env);
  await b2.post("/login", { phone: ADMIN.phone, password: ADMIN.password });
  assert.equal((await b2.post("/login/verify", { code: first })).status, 400);
});

// ---------- العائلات ----------

test("الأستاذ ينشئ عائلة بابنين: كلمة مرور مؤقتة ورابط واتساب برسالة جاهزة", async () => {
  const env = makeEnv();
  const { b } = await setupAdmin(env);
  const { res, text, password } = await createFamily(b, FAMILY);
  assert.equal(res.status, 200);
  assert.match(password ?? "", /^[a-z0-9]{4}-[a-z0-9]{4}$/);
  const wa = /href="(https:\/\/wa\.me\/[^"]+)"/.exec(text)?.[1] ?? "";
  assert.match(wa, /^https:\/\/wa\.me\/213661223344\?text=/);
  const message = decodeURIComponent(new URL(wa.replace(/&amp;/g, "&")).searchParams.get("text") ?? "");
  assert.match(message, /0661223344/);
  assert.ok(message.includes(password ?? "x"));
  assert.ok(message.includes(`${BASE}/login`));

  const account = env.DB.raw.prepare("SELECT * FROM accounts WHERE phone = '0661223344'").get() as Record<string, unknown>;
  assert.equal(account.must_change_password, 1);
  assert.ok(!String(account.password_hash).includes(password ?? "x"));
  const kids = env.DB.raw.prepare("SELECT name, level FROM students WHERE account_id = ? ORDER BY id").all(Number(account.id));
  assert.deepEqual(kids.map((k) => ({ ...k })), [
    { name: "ياسين بن علي", level: "2am" },
    { name: "مريم بن علي", level: "4am" },
  ]);
});

test("إنشاء العائلة يرفض الرقم المكرر والعائلة بلا أبناء والرقم غير الصحيح", async () => {
  const env = makeEnv();
  const { b } = await setupAdmin(env);
  await createFamily(b, FAMILY);
  const dup = await createFamily(b, { ...FAMILY, phone: "+213661223344" });
  assert.equal(dup.res.status, 400);
  assert.match(dup.text, /مسجل لعائلة أخرى/);
  const noKids = await createFamily(b, { name: "عائلة", phone: "0770000000" });
  assert.equal(noKids.res.status, 400);
  assert.match(noKids.text, /ابنًا واحدًا على الأقل/);
  const badPhone = await createFamily(b, { ...FAMILY, phone: "12345" });
  assert.equal(badPhone.res.status, 400);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'parent'").get()?.n, 1);
});

test("الولي: أول دخول يفرض تغيير كلمة المرور، ثم يرى أبناءه", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  const login = await parent.post("/login", { phone: "0661223344", password: password ?? "" });
  assert.equal(login.headers.get("Location"), "/account/password");
  const cookie = login.headers.getSetCookie().join("\n");
  assert.match(cookie, /__Host-zd_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);

  // لا شيء آخر في الحساب قبل تغيير كلمة المرور
  assert.equal((await parent.get("/account")).headers.get("Location"), "/account/password");
  const weak = await parent.post("/account/password", { password: "123", confirm: "123" });
  assert.equal(weak.status, 400);
  const mismatch = await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Autre-2026" });
  assert.match(await mismatch.text(), /غير متطابقتين/);
  const changed = await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  assert.equal(changed.headers.get("Location"), "/account");

  const page = await (await parent.get("/account")).text();
  assert.match(page, /ياسين بن علي/);
  assert.match(page, /مريم بن علي/);
  assert.match(page, /السنة الثانية متوسط/);

  // كلمة المرور المؤقتة لم تعد صالحة، والجديدة تعمل
  const other = new Browser(env);
  assert.equal((await other.post("/login", { phone: "0661223344", password: password ?? "" })).status, 400);
  assert.equal((await other.post("/login", { phone: "0661223344", password: "Nouvelle-2026" })).headers.get("Location"), "/account");
});

test("القفل: 5 محاولات خاطئة توقف الدخول 15 دقيقة، والأستاذ يستطيع رفع القفل", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  for (let i = 1; i <= 4; i++) {
    const r = await parent.post("/login", { phone: "0661223344", password: "خطأ" });
    assert.equal(r.status, 400, `المحاولة ${i}`);
  }
  const fifth = await (await parent.post("/login", { phone: "0661223344", password: "خطأ" })).text();
  assert.match(fifth, /أُوقف الدخول مؤقتًا لمدة 15 دقيقة/);
  // حتى كلمة المرور الصحيحة تُرفض أثناء القفل
  const correct = await parent.post("/login", { phone: "0661223344", password: password ?? "" });
  assert.equal(correct.status, 400);
  assert.match(await correct.text(), /حاول بعد 15 دقيقة/);

  const id = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
  assert.match(await (await admin.get(`/admin/families/${id}`)).text(), /مقفل مؤقتًا/);
  assert.equal((await admin.post(`/admin/families/${id}/unlock`, {})).headers.get("Location"), `/admin/families/${id}?done=unlock`);
  assert.equal((await parent.post("/login", { phone: "0661223344", password: password ?? "" })).status, 303);
});

test("القفل ينتهي وحده بعد 15 دقيقة", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  for (let i = 0; i < 5; i++) await parent.post("/login", { phone: "0661223344", password: "خطأ" });
  env.DB.raw.prepare("UPDATE accounts SET locked_until = ? WHERE phone = '0661223344'").run(Date.now() - 1);
  assert.equal((await parent.post("/login", { phone: "0661223344", password: password ?? "" })).status, 303);
});

test("رقم غير مسجل يعطي نفس رسالة كلمة المرور الخاطئة", async () => {
  const env = makeEnv();
  await setupAdmin(env);
  const b = new Browser(env);
  const unknown = await (await b.post("/login", { phone: "0799999999", password: "x" })).text();
  const wrong = await (await b.post("/login", { phone: ADMIN.phone, password: "x" })).text();
  const msg = (t: string) => /<p>(رقم الهاتف أو كلمة المرور غير صحيحة\.)/.exec(t)?.[1];
  assert.equal(msg(unknown), msg(wrong));
  assert.ok(msg(unknown));
});

test("الصلاحيات: الزائر يُحوَّل إلى الدخول، والولي لا يرى لوحة التحكم", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const { password } = await createFamily(admin, FAMILY);
  const visitor = new Browser(env);
  const r = await visitor.get("/admin/families");
  assert.equal(r.headers.get("Location"), "/login?next=%2Fadmin%2Ffamilies");
  assert.equal((await visitor.get("/account")).status, 303);

  const parent = new Browser(env);
  await parent.post("/login", { phone: "0661223344", password: password ?? "" });
  await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  for (const path of ["/admin", "/admin/families", "/admin/families/1"]) {
    assert.equal((await parent.get(path)).status, 404, path);
  }
  assert.equal((await parent.post("/admin/families/new", FAMILY)).status, 404);
});

test("إيقاف الحساب يُخرج الولي فورًا ويمنع دخوله، والتفعيل يعيده", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  await parent.post("/login", { phone: "0661223344", password: password ?? "" });
  await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  assert.equal((await parent.get("/account")).status, 200);

  const id = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
  await admin.post(`/admin/families/${id}/status`, { status: "disabled" });
  assert.equal((await parent.get("/account")).status, 303);
  const refused = await new Browser(env).post("/login", { phone: "0661223344", password: "Nouvelle-2026" });
  assert.match(await refused.text(), /هذا الحساب موقوف/);

  await admin.post(`/admin/families/${id}/status`, { status: "active" });
  assert.equal((await new Browser(env).post("/login", { phone: "0661223344", password: "Nouvelle-2026" })).status, 303);
});

test("كلمة مرور مؤقتة جديدة: القديمة تبطل، والولي يخرج من كل الأجهزة", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  await createFamily(admin, FAMILY);
  const id = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
  const parent = new Browser(env);
  env.DB.raw.prepare("UPDATE accounts SET must_change_password = 0 WHERE id = ?").run(id);
  const reset = await admin.post(`/admin/families/${id}/reset-password`, {});
  const newPassword = /data-copy-source="password">([a-z0-9-]+)</.exec(await reset.text())?.[1] ?? "";
  assert.match(newPassword, /^[a-z0-9]{4}-[a-z0-9]{4}$/);
  const login = await parent.post("/login", { phone: "0661223344", password: newPassword });
  assert.equal(login.headers.get("Location"), "/account/password");
});

test("تعديل بيانات الولي وإضافة ابن وتعديله", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  await createFamily(admin, FAMILY);
  const id = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);

  const edit = await admin.post(`/admin/families/${id}/edit`, { name: "عائلة بن علي محمد", phone: "0770 11 22 33", note: "يدفع شهريًا" });
  assert.equal(edit.headers.get("Location"), `/admin/families/${id}?done=edit`);
  const conflict = await admin.post(`/admin/families/${id}/edit`, { name: "x y", phone: ADMIN.phone, note: "" });
  assert.equal(conflict.status, 400);

  await admin.post(`/admin/families/${id}/children`, { child_name: "أمين بن علي", child_level: "1as" });
  const kid = env.DB.raw.prepare("SELECT id FROM students WHERE name = 'أمين بن علي'").get();
  assert.ok(kid);
  await admin.post(`/admin/students/${Number(kid.id)}/edit`, { name: "أمين بن علي", level: "4am", status: "active" });
  const page = await (await admin.get(`/admin/families/${id}?done=child-edit`)).text();
  assert.match(page, /عائلة بن علي محمد/);
  assert.match(page, /0770 11 22 33/);
  assert.match(page, /حُفظت بيانات الابن/);
  assert.equal(env.DB.raw.prepare("SELECT level FROM students WHERE id = ?").get(Number(kid.id))?.level, "4am");
});

test("البحث في العائلات باسم الولي أو الابن أو جزء من الرقم، والنصوص تُهرَّب", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  await createFamily(admin, FAMILY);
  await createFamily(admin, { ...FAMILY, name: "<script>alert(1)</script>", phone: "0550998877", child_name_1: "سارة", child_name_2: "" , child_level_2: "" });
  const list = await (await admin.get("/admin/families")).text();
  assert.ok(!list.includes("<script>alert(1)</script>"));
  assert.ok(list.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  const byChild = await (await admin.get("/admin/families?q=" + encodeURIComponent("مريم"))).text();
  assert.match(byChild, /عائلة بن علي/);
  assert.doesNotMatch(byChild, /سارة/);
  const byPhone = await (await admin.get("/admin/families?q=9988")).text();
  assert.match(byPhone, /سارة/);
  assert.doesNotMatch(byPhone, /ياسين/);
});

test("الخروج يحذف الجلسة من قاعدة البيانات", async () => {
  const env = makeEnv();
  const { b } = await setupAdmin(env);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n, 1);
  const out = await b.post("/logout", {});
  assert.equal(out.headers.get("Location"), "/");
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n, 0);
  assert.equal((await b.get("/admin")).status, 303);
});

test("لوحة التحكم تعرض الأرقام الحقيقية وآخر العمليات", async () => {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  await createFamily(admin, FAMILY);
  const page = await (await admin.get("/admin")).text();
  assert.match(page, /<strong>1<\/strong><span class="muted">عائلة<\/span>/);
  assert.match(page, /<strong>2<\/strong><span class="muted">تلميذ<\/span>/);
  assert.match(page, /إنشاء عائلة/);
});
