// نقطة الدخول للخادم (Cloudflare Worker).
// الملفات الثابتة (الشعار، التنسيق) تقدّمها Cloudflare مباشرة من مجلد public.
// كل طلب آخر يصل إلى هنا: الصفحات تُبنى في الخادم، وطلبات /api/* للبيانات.

import { findItem, findProgram } from "./catalog.ts";
import {
  homePage,
  itemPage,
  levelsPage,
  notFoundPage,
  programPage,
  subscribePage,
} from "./pages.ts";

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

/** سياسة المحتوى للصفحات: لا كود ولا تنسيق إلا من موقعنا. */
export const PAGE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
    },
  });
}

/** قواعد التحميل المسبق: المتصفح يجهّز الصفحة التالية قبل الضغط، فيبدو التنقل فوريًا. */
export const SPECULATION_RULES = {
  prerender: [{ where: { href_matches: "/*" }, eagerness: "moderate" }],
};

export function page(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": PAGE_CSP,
      "Speculation-Rules": '"/speculation-rules.json"',
      ...SECURITY_HEADERS,
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...SECURITY_HEADERS } });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/health") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    return json({ status: "ok", environment: env.APP_ENV });
  }
  return json({ error: "not_found" }, 404);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (path === "/api" || path.startsWith("/api/")) {
    return handleApi(request, env, path);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS } });
  }

  if (path === "/speculation-rules.json") {
    return new Response(JSON.stringify(SPECULATION_RULES), {
      headers: { "Content-Type": "application/speculationrules+json", ...SECURITY_HEADERS },
    });
  }

  if (path === "/") return page(homePage(env.APP_ENV));
  if (path === "/levels") return page(levelsPage(env.APP_ENV));
  if (path === "/subscribe") {
    const found = findItem(url.searchParams.get("item") ?? "");
    const locked = found && !found.item.free ? { program: found.program, item: found.item } : undefined;
    return page(subscribePage(env.APP_ENV, locked));
  }

  const programMatch = /^\/levels\/([a-z0-9-]+)$/.exec(path);
  if (programMatch) {
    const program = findProgram(programMatch[1] ?? "");
    if (program) return page(programPage(env.APP_ENV, program));
    return page(notFoundPage(env.APP_ENV), 404);
  }

  const itemMatch = /^\/items\/([a-z0-9-]+)$/.exec(path);
  if (itemMatch) {
    const found = findItem(itemMatch[1] ?? "");
    if (!found) return page(notFoundPage(env.APP_ENV), 404);
    // المحتوى المدفوع لا يُعرض أبدًا للزائر: يُحوَّل إلى صفحة الاشتراك.
    if (!found.item.free) return redirect(`/subscribe?item=${encodeURIComponent(found.item.id)}`);
    return page(itemPage(env.APP_ENV, found.program, found.unit, found.item));
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status === 404) return page(notFoundPage(env.APP_ENV), 404);
  return asset;
}

export default { fetch: handleRequest };
