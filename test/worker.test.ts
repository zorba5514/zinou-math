import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, PAGE_CSP, SECURITY_HEADERS, type Env } from "../src/index.ts";
import { createTestDb } from "./helpers/d1.ts";

// بيئة وهمية: ASSETS تعرف ملفًا واحدًا فقط (/styles.css) وترد 404 لغيره.
function fakeEnv(appEnv = "test"): Env & { assetCalls: string[]; DB: ReturnType<typeof createTestDb> } {
  const assetCalls: string[] = [];
  return {
    APP_ENV: appEnv,
    DB: createTestDb(),
    assetCalls,
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        assetCalls.push(path);
        return path === "/styles.css"
          ? new Response("css", { status: 200 })
          : new Response("missing", { status: 404 });
      },
    },
  };
}

const base = "https://example.test";
const get = (path: string, env = fakeEnv(), init?: RequestInit) =>
  handleRequest(new Request(`${base}${path}`, init), env);

test("فحص الصحة يرد بحالة سليمة واسم البيئة", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { status: "ok", environment: "test", database: "ok" });
});

test("فحص الصحة يرفض الطرق غير GET", async () => {
  const res = await get("/api/health", fakeEnv(), { method: "POST" });
  assert.equal(res.status, 405);
});

test("مسار API غير معروف يرد 404 ولا يصل إلى الملفات الثابتة", async () => {
  const env = fakeEnv();
  for (const path of ["/api", "/api/unknown", "/api/admin/secret"]) {
    const res = await get(path, env);
    assert.equal(res.status, 404, path);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
  assert.equal(env.assetCalls.length, 0);
});

test("الصفحات العامة ترد 200 بصفحة عربية", async () => {
  for (const path of ["/", "/levels", "/levels/1am", "/levels/olympiad", "/subscribe", "/items/1am-u1-i1", "/levels/"]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("Content-Type") ?? "", /text\/html/, path);
    assert.match(await res.text(), /<html lang="ar" dir="rtl">/, path);
  }
});

test("الصفحات تحمل ترويسات الأمان وسياسة المحتوى", async () => {
  const res = await get("/");
  assert.equal(res.headers.get("Content-Security-Policy"), PAGE_CSP);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(res.headers.get(name), value, name);
  }
});

test("العنصر المدفوع لا يُعرض للزائر بل يُحوَّل إلى صفحة الاشتراك", async () => {
  const res = await get("/items/1am-u1-i3");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/subscribe?item=1am-u1-i3");
});

test("صفحة الاشتراك تذكر العنصر المقفل الذي جاء منه الزائر", async () => {
  const body = await (await get("/subscribe?item=1am-u1-i3")).text();
  assert.match(body, /درس تجريبي مدفوع/);
  assert.match(body, /السنة الأولى متوسط/);
});

test("صفحة الاشتراك لا تذكر عنصرًا مجانيًا أو غير موجود كأنه مقفل", async () => {
  for (const q of ["1am-u1-i1", "nothing", "<script>"]) {
    const body = await (await get(`/subscribe?item=${encodeURIComponent(q)}`)).text();
    assert.doesNotMatch(body, /notice-lock/, q);
  }
});

test("الروابط غير الموجودة ترد بصفحة 404 عربية", async () => {
  for (const path of ["/levels/xyz", "/items/xyz", "/nothing-here"]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.match(await res.text(), /الصفحة غير موجودة/, path);
  }
});

test("الملفات الثابتة الموجودة تُقدَّم كما هي", async () => {
  const res = await get("/styles.css");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "css");
});

test("الطرق غير المدعومة تُرفض، والنماذج من خارج الموقع تُرفض", async () => {
  assert.equal((await get("/levels", fakeEnv(), { method: "DELETE" })).status, 405);
  // نموذج بلا ترويسة Origin أو من موقع آخر: مرفوض
  assert.equal((await get("/levels", fakeEnv(), { method: "POST" })).status, 403);
  assert.equal((await get("/logout", fakeEnv(), { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403);
  // نموذج من نفس الموقع إلى صفحة لا تقبل النماذج: غير موجودة
  assert.equal((await get("/levels", fakeEnv(), { method: "POST", headers: { Origin: base } })).status, 404);
});

test("شريط نسخة الاختبار يظهر في موقع الاختبار فقط", async () => {
  const staging = await (await get("/", fakeEnv("staging"))).text();
  const production = await (await get("/", fakeEnv("production"))).text();
  assert.match(staging, /نسخة الاختبار/);
  assert.match(staging, /name="robots" content="noindex"/);
  assert.doesNotMatch(production, /نسخة الاختبار/);
  assert.doesNotMatch(production, /noindex/);
});

test("قواعد التحميل المسبق تُقدَّم بالنوع الصحيح وتُعلن في كل صفحة", async () => {
  const rules = await get("/speculation-rules.json");
  assert.equal(rules.headers.get("Content-Type"), "application/speculationrules+json");
  assert.ok(Array.isArray((await rules.json()).prerender));
  const res = await get("/levels");
  assert.equal(res.headers.get("Speculation-Rules"), '"/speculation-rules.json"');
});

test("فحص الصحة يكشف قاعدة بيانات بلا جداول", async () => {
  const env = fakeEnv();
  env.DB.raw.exec("DROP TABLE recovery_codes; DROP TABLE devices; DROP TABLE sessions; DROP TABLE students; DROP TABLE accounts;");
  const res = await get("/api/health", env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).database, "error");
});
