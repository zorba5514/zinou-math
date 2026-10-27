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

/** محتوى تجريبي: مقطع منشور في 1 متوسط فيه درس مجاني ودرس مدفوع ودرس مسودة، ومقطع مسودة. */
function seedContent(env: ReturnType<typeof fakeEnv>) {
  const now = Date.now();
  env.DB.raw.exec(`
    INSERT INTO units (id, program_slug, title, position, status, created_at, updated_at) VALUES
      (1, '1am', 'المقطع الأول: الأعداد', 1, 'published', ${now}, ${now}),
      (2, '1am', 'مقطع لم يُنشر', 2, 'draft', ${now}, ${now});
    INSERT INTO lessons (id, unit_id, kind, title, position, free, status, youtube_id, created_at, updated_at) VALUES
      (1, 1, 'video', 'درس مجاني', 1, 1, 'published', 'FREEvid0001', ${now}, ${now}),
      (2, 1, 'video', 'درس مدفوع', 2, 0, 'published', 'PAIDvid0002', ${now}, ${now}),
      (3, 1, 'video', 'درس مسودة', 3, 1, 'draft', 'DRAFTvid003', ${now}, ${now}),
      (4, 2, 'video', 'درس في مقطع مسودة', 1, 1, 'published', 'HIDDENvid04', ${now}, ${now});
  `);
  return env;
}
const get = (path: string, env = fakeEnv(), init?: RequestInit) =>
  handleRequest(new Request(`${base}${path}`, init), env);

test("فحص الصحة يرد بحالة سليمة واسم البيئة", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/json/);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.environment, "test");
  assert.equal(body.database, "ok");
  assert.equal(typeof body.db_ms, "number");
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
  const env = seedContent(fakeEnv());
  for (const path of ["/", "/levels", "/levels/1am", "/levels/olympiad", "/subscribe", "/lessons/1", "/levels/"]) {
    const res = await get(path, env);
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

test("الدرس المجاني يعرض الفيديو، والمدفوع يُحوَّل إلى الاشتراك دون كشف معرّف الفيديو", async () => {
  const env = seedContent(fakeEnv());
  const free = await (await get("/lessons/1", env)).text();
  assert.match(free, /youtube-nocookie\.com\/embed\/FREEvid0001/);
  const res = await get("/lessons/2", env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/subscribe?lesson=2");
  assert.equal(await res.text(), "");
  // صفحة المستوى تذكر عنوان الدرس المدفوع بقفل، ولا تحتوي أي معرّف فيديو
  const level = await (await get("/levels/1am", env)).text();
  assert.match(level, /درس مدفوع/);
  assert.match(level, /href="\/subscribe\?lesson=2"/);
  for (const id of ["FREEvid0001", "PAIDvid0002", "DRAFTvid003", "HIDDENvid04"]) assert.ok(!level.includes(id), id);
});

test("المسودة لا تظهر لأحد: لا الدرس المسودة ولا المقطع المسودة", async () => {
  const env = seedContent(fakeEnv());
  const level = await (await get("/levels/1am", env)).text();
  assert.doesNotMatch(level, /درس مسودة/);
  assert.doesNotMatch(level, /مقطع لم يُنشر/);
  assert.equal((await get("/lessons/3", env)).status, 404);
  assert.equal((await get("/lessons/4", env)).status, 404);
});

test("صفحة الاشتراك تذكر الدرس المقفل الذي جاء منه الزائر", async () => {
  const env = seedContent(fakeEnv());
  const body = await (await get("/subscribe?lesson=2", env)).text();
  assert.match(body, /درس مدفوع/);
  assert.match(body, /السنة الأولى متوسط/);
});

test("صفحة الاشتراك لا تذكر درسًا مجانيًا أو مسودة أو غير موجود كأنه مقفل", async () => {
  const env = seedContent(fakeEnv());
  for (const q of ["1", "3", "999", "nothing", "<script>"]) {
    const body = await (await get(`/subscribe?lesson=${encodeURIComponent(q)}`, env)).text();
    assert.doesNotMatch(body, /notice-lock/, q);
  }
});

test("المستوى بلا دروس منشورة يقول إنها قيد الإعداد", async () => {
  const body = await (await get("/levels/3am")).text();
  assert.match(body, /الدروس قيد الإعداد/);
});

test("الروابط غير الموجودة ترد بصفحة 404 عربية", async () => {
  for (const path of ["/levels/xyz", "/lessons/999", "/lessons/abc", "/nothing-here"]) {
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
  env.DB.raw.exec("PRAGMA foreign_keys = OFF; DROP TABLE recovery_codes; DROP TABLE devices; DROP TABLE sessions; DROP TABLE students; DROP TABLE accounts;");
  const res = await get("/api/health", env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).database, "error");
});
