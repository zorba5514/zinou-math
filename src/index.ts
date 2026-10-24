// نقطة الدخول للخادم (Cloudflare Worker).
// الملفات الثابتة (الشعار، التنسيق) تقدّمها Cloudflare مباشرة من مجلد public.
// كل طلب آخر يصل إلى هنا: الصفحات تُبنى في الخادم، وطلبات /api/* للبيانات.

import { canOpen, getLesson, getProgram, isPublished, listPrograms, programUnits, type Lesson } from "./content.ts";
import { homePage, lessonPage, levelsPage, notFoundPage, programPage, subscribePage } from "./pages.ts";
import { currentSession } from "./auth.ts";
import { handleAuthRoutes, type Ctx } from "./auth-routes.ts";
import { handleAdminRoutes } from "./admin-routes.ts";
import { handleFamilyRoutes } from "./family-routes.ts";
import { messagePage } from "./auth-pages.ts";
import { SECURITY_HEADERS, isSameOrigin, json, page, redirect, type Env } from "./http.ts";
import type { View, Viewer } from "./ui.ts";
import type { Student } from "./db.ts";

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
          { not: { href_matches: "/profiles*" } },
          { not: { href_matches: "/home" } },
          { not: { href_matches: "/files/*" } },
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

async function publicRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, url, view } = ctx;
  const db = ctx.env.DB;
  // الأستاذ يرى المسودات أيضًا (معاينة)، والبقية يرون المنشور فقط
  const isAdmin = view.viewer?.role === "admin";
  if (path === "/") return page(homePage(view, await listPrograms(db)));
  if (path === "/levels") return page(levelsPage(view, await listPrograms(db)));
  if (path === "/subscribe") {
    const id = url.searchParams.get("lesson") ?? "";
    const found = /^\d{1,12}$/.test(id) ? await getLesson(db, Number(id)) : null;
    const locked = found && isPublished(found) && !found.lesson.free ? { program: found.program, lesson: found.lesson } : undefined;
    return page(subscribePage(view, locked));
  }
  const programMatch = /^\/levels\/([a-z0-9-]+)$/.exec(path);
  if (programMatch) {
    const program = await getProgram(db, programMatch[1] ?? "");
    if (!program) return page(notFoundPage(view), 404);
    return page(programPage(view, program, await programUnits(db, program.slug, { drafts: isAdmin })));
  }
  const lessonMatch = /^\/lessons\/(\d{1,12})$/.exec(path);
  if (lessonMatch) {
    const found = await getLesson(db, Number(lessonMatch[1]));
    if (!found || (!isPublished(found) && !isAdmin)) return page(notFoundPage(view), 404);
    // المدفوع لا يُعرض أبدًا لمن لا يحق له: يُحوَّل إلى صفحة الاشتراك، ولا يصل إليه معرّف الفيديو
    if (!canOpen(view.viewer, found.lesson)) return redirect(`/subscribe?lesson=${found.lesson.id}`, [], 302);
    const next = await db
      .prepare(
        `SELECT * FROM lessons WHERE unit_id = ? AND (position > ? OR (position = ? AND id > ?)) ${isAdmin ? "" : "AND status = 'published'"}
         ORDER BY position, id LIMIT 1`,
      )
      .bind(found.unit.id, found.lesson.position, found.lesson.position, found.lesson.id)
      .first<Lesson>();
    return page(lessonPage(view, found, next));
  }
  const fileMatch = /^\/files\/(\d{1,12})$/.exec(path);
  if (fileMatch) return serveFile(ctx, Number(fileMatch[1]));
  return null;
}

/** ملف PDF لدرس: نفس قواعد الدرس (منشور، ومن يحق له)، وحسب طريقة الإتاحة التي اختارها الأستاذ. */
async function serveFile(ctx: Ctx, id: number): Promise<Response> {
  const { view } = ctx;
  const isAdmin = view.viewer?.role === "admin";
  const found = await getLesson(ctx.env.DB, id);
  if (!found || found.lesson.kind !== "pdf" || !found.lesson.file_key || (!isPublished(found) && !isAdmin)) {
    return page(notFoundPage(view), 404);
  }
  if (!canOpen(view.viewer, found.lesson)) return redirect(`/subscribe?lesson=${id}`, [], 302);
  const download = ctx.url.searchParams.get("download") === "1";
  const mode = found.lesson.file_mode ?? "both";
  if ((download && mode === "view") || (!download && mode === "download")) return page(notFoundPage(view), 404);
  const object = ctx.env.FILES ? await ctx.env.FILES.get(found.lesson.file_key) : null;
  if (!object) return page(notFoundPage(view), 404);
  const name = found.lesson.file_name ?? "file.pdf";
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(object.size),
      // اسم الملف بالعربية حسب المعيار RFC 5987، مع اسم احتياطي بالحروف اللاتينية
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="lesson-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
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
  let viewer: Viewer | null = null;
  if (user) {
    viewer = { name: user.account.name, role: user.account.role, profile: null };
    if (user.account.role === "parent" && user.session.profile_kind === "parent") viewer.profile = "parent";
    if (user.account.role === "parent" && user.session.profile_kind === "student" && user.session.student_id !== null) {
      // اسم الابن يظهر في القائمة؛ ابن موقوف أو محذوف يعني أن الملف لم يعد صالحًا
      const student = await env.DB
        .prepare("SELECT * FROM students WHERE id = ? AND account_id = ? AND status = 'active'")
        .bind(user.session.student_id, user.account.id)
        .first<Student>();
      if (student) viewer = { ...viewer, name: student.name, profile: "student" };
    }
  }
  const view: View = { env: env.APP_ENV, viewer };

  if (method === "POST" && !isSameOrigin(request)) {
    return page(messagePage(view, "طلب مرفوض", "أُرسل هذا النموذج من خارج الموقع، فرُفض حمايةً لحسابك.", "error"), 403);
  }

  const ctx: Ctx = { request, env, url, path, method, now, current, user, view };

  const accountArea =
    path.startsWith("/admin") || path === "/account" || path.startsWith("/account/") || path === "/home" || path === "/profiles" || path.startsWith("/profiles/");
  // من يدخل بكلمة مرور مؤقتة يجب أن يغيّرها قبل أي شيء آخر في حسابه
  if (user?.account.must_change_password && accountArea && path !== "/account/password") {
    return redirect("/account/password");
  }
  // كلمة مرور العائلة يغيّرها الولي فقط، لا من ملف أحد الأبناء
  if (user?.account.role === "parent" && viewer?.profile === "student" && path === "/account/password") {
    return redirect("/home");
  }

  const routed = (await handleAuthRoutes(ctx)) ?? (await handleAdminRoutes(ctx)) ?? (await handleFamilyRoutes(ctx));
  if (routed) return routed;

  if (method === "POST") return page(notFoundPage(view), 404);
  const pub = await publicRoutes(ctx);
  if (pub) return pub;

  const asset = await env.ASSETS.fetch(request);
  if (asset.status === 404) return page(notFoundPage(view), 404);
  return asset;
}

export default { fetch: handleRequest };
