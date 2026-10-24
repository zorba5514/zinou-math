// أدوات مشتركة لاختبارات الحسابات: بيئة بقاعدة بيانات حقيقية (SQLite)، ومتصفح صغير يحفظ الكعكات،
// وخطوات جاهزة لتأسيس حساب الأستاذ وإنشاء عائلة.
import assert from "node:assert/strict";
import { handleRequest, type Env } from "../../src/index.ts";
import { createTestDb } from "./d1.ts";
import { base32Decode, totpAt } from "../../src/crypto.ts";

export const BASE = "https://zinou.test";
export const SETUP_CODE = "رمز-تأسيس-تجريبي-طويل";
export const ADMIN = { name: "الأستاذ زين الدين", phone: "0555000111", password: "Admin-Pass-2026" };

export type TestEnv = Env & { DB: ReturnType<typeof createTestDb> };

export function makeEnv(setupCode: string | null = SETUP_CODE): TestEnv {
  return {
    APP_ENV: "staging",
    DB: createTestDb(),
    ADMIN_SETUP_CODE: setupCode ?? undefined,
    PASSWORD_ITERATIONS: "1000",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
}

/** متصفح صغير للاختبار: يحفظ الكعكات ويرسل ترويسة Origin مع النماذج. */
export class Browser {
  env: TestEnv;
  jar = new Map<string, string>();
  last: Response | null = null;
  ua: string;
  constructor(env: TestEnv, ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile") {
    this.env = env;
    this.ua = ua;
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("Cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    headers.set("User-Agent", this.ua);
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

export function hiddenValue(htmlText: string, name: string): string {
  const m = new RegExp(`name="${name}" value="([^"]+)"`).exec(htmlText);
  assert.ok(m, `الحقل ${name} غير موجود`);
  return m[1] ?? "";
}

export async function code(secret: string, now = Date.now()): Promise<string> {
  return totpAt(base32Decode(secret), now);
}

/** ينشئ حساب الأستاذ عبر صفحة التأسيس، ويُرجع المتصفح والمفتاح ورموز الطوارئ. */
export async function setupAdmin(env: TestEnv) {
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

export async function createFamily(b: Browser, fields: Record<string, string>) {
  const res = await b.post("/admin/families/new", fields);
  const text = await res.text();
  const password = /data-copy-source="password">([a-z0-9-]+)</.exec(text)?.[1];
  return { res, text, password };
}

export const FAMILY = {
  name: "عائلة بن علي",
  phone: "0661 22 33 44",
  note: "",
  child_name_1: "ياسين بن علي",
  child_level_1: "2am",
  child_name_2: "مريم بن علي",
  child_level_2: "4am",
};
