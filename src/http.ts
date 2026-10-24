// أدوات الرد على الطلبات: الصفحات، والتحويل، والكعكات (cookies)، والحماية من الطلبات المزوّرة.

import type { D1Database } from "./db.ts";

export interface Env {
  /** الملفات الثابتة (مجلد public) التي ترفعها Cloudflare مع الخادم. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** اسم البيئة: staging لموقع الاختبار، production للموقع الحقيقي. */
  APP_ENV: string;
  /** قاعدة البيانات. */
  DB: D1Database;
  /** رمز التأسيس: يُستعمل مرة واحدة لإنشاء حساب الأستاذ. سرّ في Cloudflare، لا في الكود. */
  ADMIN_SETUP_CODE?: string;
  /** قوة تشفير كلمات المرور (عدد التكرارات). */
  PASSWORD_ITERATIONS?: string;
  /** مفتاح YouTube Data API لقراءة قوائم التشغيل. سرّ في Cloudflare، لا في الكود. */
  YOUTUBE_API_KEY?: string;
}

/** ترويسات أمان تُضاف إلى كل رد يصدر من الخادم. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

/** سياسة المحتوى للصفحات: لا كود ولا تنسيق إلا من موقعنا. */
export const PAGE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
  "frame-src https://www.youtube-nocookie.com; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS },
  });
}

export function page(body: string, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": PAGE_CSP,
    "Speculation-Rules": '"/speculation-rules.json"',
    ...SECURITY_HEADERS,
  });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(body, { status, headers });
}

/** تحويل بعد نموذج (303): المتصفح يفتح الصفحة الجديدة بطلب GET. */
export function redirect(location: string, cookies: string[] = [], status = 303): Response {
  const headers = new Headers({ Location: location, ...SECURITY_HEADERS });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status, headers });
}

// ---------- الكعكات ----------

export const SESSION_COOKIE = "__Host-zd_session";
export const DEVICE_COOKIE = "__Host-zd_device";

export function readCookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

/** كعكة آمنة: لا يقرؤها كود الصفحة، ولا تُرسل إلا عبر https، ولا تُرسل من مواقع أخرى. */
export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function clearCookie(name: string): string {
  return setCookie(name, "", 0);
}

// ---------- النماذج ----------

/**
 * يرفض أي نموذج مرسل من موقع آخر (حماية من تزوير الطلبات).
 * المتصفحات ترسل ترويسة Origin مع كل نموذج POST.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

export async function readForm(request: Request): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > 64 * 1024) return out;
  try {
    const form = await request.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string" && !out.has(k)) out.set(k, v.slice(0, 2000));
    }
  } catch {
    // نموذج غير صالح: يُعامل كنموذج فارغ
  }
  return out;
}

export function field(form: Map<string, string>, name: string): string {
  return (form.get(name) ?? "").trim();
}

/** يقبل فقط روابط داخل الموقع، حتى لا يُستعمل التحويل لإرسال الزائر إلى موقع آخر. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
