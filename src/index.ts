// نقطة الدخول للخادم (Cloudflare Worker).
// كل طلب يمر من هنا: طلبات /api/* يعالجها الخادم،
// وباقي الطلبات تُرسل إلى الملفات الثابتة في مجلد public.

export interface Env {
  /** الملفات الثابتة (مجلد public) التي ترفعها Cloudflare مع الخادم. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** اسم البيئة: staging لموقع الاختبار، production للموقع الحقيقي. */
  APP_ENV: string;
}

/** ترويسات أمان تُضاف إلى كل رد يصدر من الخادم. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
    },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405);
    }
    return json({ status: "ok", environment: env.APP_ENV });
  }

  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return json({ error: "not_found" }, 404);
  }

  return env.ASSETS.fetch(request);
}

export default { fetch: handleRequest };
