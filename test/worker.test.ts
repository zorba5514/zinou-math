import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, SECURITY_HEADERS, type Env } from "../src/index.ts";

// بيئة وهمية: ASSETS ترد بنص ثابت حتى نتأكد أن الطلب وصلها.
function fakeEnv(): Env & { assetCalls: string[] } {
  const assetCalls: string[] = [];
  return {
    APP_ENV: "test",
    assetCalls,
    ASSETS: {
      async fetch(request: Request) {
        assetCalls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  };
}

const base = "https://example.test";

test("فحص الصحة يرد بحالة سليمة واسم البيئة", async () => {
  const res = await handleRequest(new Request(`${base}/api/health`), fakeEnv());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { status: "ok", environment: "test" });
});

test("فحص الصحة يرفض الطرق غير GET", async () => {
  const res = await handleRequest(
    new Request(`${base}/api/health`, { method: "POST" }),
    fakeEnv(),
  );
  assert.equal(res.status, 405);
});

test("مسار API غير معروف يرد 404 ولا يصل إلى الملفات الثابتة", async () => {
  const env = fakeEnv();
  for (const path of ["/api", "/api/unknown", "/api/admin/secret"]) {
    const res = await handleRequest(new Request(`${base}${path}`), env);
    assert.equal(res.status, 404, path);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
  assert.equal(env.assetCalls.length, 0);
});

test("المسارات الأخرى تُرسل إلى الملفات الثابتة", async () => {
  const env = fakeEnv();
  const res = await handleRequest(new Request(`${base}/`), env);
  assert.equal(await res.text(), "asset");
  assert.deepEqual(env.assetCalls, ["/"]);
});

test("ردود الخادم تحمل ترويسات الأمان", async () => {
  const res = await handleRequest(new Request(`${base}/api/health`), fakeEnv());
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(res.headers.get(name), value, name);
  }
});
