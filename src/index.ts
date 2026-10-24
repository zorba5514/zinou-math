// نقطة الدخول للخادم (Cloudflare Worker).
// الملفات الثابتة (الشعار، التنسيق) تقدّمها Cloudflare مباشرة من مجلد public.
// كل طلب آخر يصل إلى هنا: الصفحات تُبنى في الخادم، وطلبات /api/* للبيانات.

import { findItem, findProgram } from "./catalog.ts";
import { homePage, itemPage, levelsPage, notFoundPage, programPage, subscribePage } from "./pages.ts";
import { currentSession } from "./auth.ts";
import { handleAuthRoutes, type Ctx } from "./auth-routes.ts";
import { handleAdminRoutes } from "./admin-routes.ts";
import { messagePage } from "./auth-pages.ts";
import { SECURITY_HEADERS, isSameOrigin, json, page, redirect, type Env } from "./http.ts";
import type { View } from "./ui.ts";

export { PAGE_CSP, SECURITY_HEADERS, json, page, type Env } from "./http.ts";

/** قواعد التحميل المسبق: المتصفح يجهّز الصفحة التالية قبل الضغط، فيبدو التنقل فوريًا. */
export const SPECULATION_RULES = {
  prerender: [
    {
      where: {
        and: [
          { href_matches: "/*" },
          // لا تحميل مسبق لصفحات الحساب ولوحة التحكم: يجب أن تُطلب فعلًا لتعكس آخر حالة
          { not: { href_matches: "/admin*" } },
          { not: { href_matches: "/account*" } },
          { not: { href_matches: "/login*" } },
          { not: { href_matches: "/setup" } },
        ],
      },
      eagerness: "moderate",
    },
  ],
};

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/health") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    // يتأكد أن قاعدة البيانات متصلة وأن الجداول موجودة
    let database = "ok";
    try {
      await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first();
    } catch {
      database = "error";
    }
    return json({ status: database === "ok" ? "ok" : "degraded", environment: env.APP_ENV, database }, database === "ok" ? 200 : 503);
  }
  return json({ error: "not_found" }, 404);
}

function publicRoutes(ctx: Ctx): Response | null {
  const { path, url, view } = ctx;
  if (path === "/") return page(homePage(view));
  if (path === "/levels") return page(levelsPage(view));
  if (path === "/subscribe") {
    const found = findItem(url.searchParams.get("item") ?? "");
    const locked = found && !found.item.free ? { program: found.program, item: found.item } : undefined;
    return page(subscribePage(view, locked));
  }
  const programMatch = /^\/levels\/([a-z0-9-]+)$/.exec(path);
  if (programMatch) {
    const program = findProgram(programMatch[1] ?? "");
    return program ? page(programPage(view, program)) : page(notFoundPage(view), 404);
  }
  const itemMatch = /^\/items\/([a-z0-9-]+)$/.exec(path);
  if (itemMatch) {
    const found = findItem(itemMatch[1] ?? "");
    if (!found) return page(notFoundPage(view), 404);
    // المحتوى المدفوع لا يُعرض أبدًا للزائر: يُحوَّل إلى صفحة الاشتراك.
    if (!found.item.free) return redirect(`/subscribe?item=${encodeURIComponent(found.item.id)}`, [], 302);
    return page(itemPage(view, found.program, found.unit, found.item));
  }
  return null;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const method = request.method === "HEAD" ? "GET" : request.method;

  if (path === "/api" || path.startsWith("/api/")) return handleApi(request, env, path);

  if (path === "/speculation-rules.json") {
    return new Response(JSON.stringify(SPECULATION_RULES), {
      headers: { "Content-Type": "application/speculationrules+json", ...SECURITY_HEADERS },
    });
  }

  if (method !== "GET" && method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, POST", ...SECURITY_HEADERS } });
  }

  const now = Date.now();
  const current = await currentSession(env.DB, request, now);
  const user = current?.session.stage === "full" ? current : null;
  const view: View = {
    env: env.APP_ENV,
    viewer: user ? { name: user.account.name, role: user.account.role } : null,
  };

  if (method === "POST" && !isSameOrigin(request)) {
    return page(messagePage(view, "طلب مرفوض", "أُرسل هذا النموذج من خارج الموقع، فرُفض حمايةً لحسابك.", "error"), 403);
  }

  const ctx: Ctx = { request, env, url, path, method, now, current, user, view };

  // من يدخل بكلمة مرور مؤقتة يجب أن يغيّرها قبل أي شيء آخر في حسابه
  if (user?.account.must_change_password && (path.startsWith("/admin") || path === "/account")) {
    return redirect("/account/password");
  }

  const routed = (await handleAuthRoutes(ctx)) ?? (await handleAdminRoutes(ctx));
  if (routed) return routed;

  if (method === "POST") return page(notFoundPage(view), 404);
  const pub = publicRoutes(ctx);
  if (pub) return pub;

  const asset = await env.ASSETS.fetch(request);
  if (asset.status === 404) return page(notFoundPage(view), 404);
  return asset;
}

export default { fetch: handleRequest };
