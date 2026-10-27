// نقطة الدخول للخادم (Cloudflare Worker).
// الملفات الثابتة (الشعار، التنسيق) تقدّمها Cloudflare مباشرة من مجلد public.
// كل طلب آخر يصل إلى هنا: الصفحات تُبنى في الخادم، وطلبات /api/* للبيانات.

import { getLesson, isPublished, listPrograms, programWithUnits, type Lesson, type LessonContext } from "./content.ts";
import { NO_ACCESS, accessStatement, canOpen, getSettings, visibleSince, type Access } from "./subscriptions.ts";
import { homePage, lessonPage, levelsPage, notFoundPage, programPage, subscribePage } from "./pages.ts";
import { currentSession } from "./auth.ts";
import { handleAuthRoutes, type Ctx } from "./auth-routes.ts";
import { handleAdminRoutes } from "./admin-routes.ts";
import { handleFamilyRoutes } from "./family-routes.ts";
import { handleQuizRoutes, quizIntro } from "./quiz-routes.ts";
import { messagePage } from "./auth-pages.ts";
import { SECURITY_HEADERS, THEME_COOKIE, field, isSameOrigin, json, page, readCookies, readForm, redirect, safeNext, type Env } from "./http.ts";
import { isTeacherView, type View, type Viewer } from "./ui.ts";
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
          { not: { href_matches: "/attempts/*" } },
          { not: { href_matches: "/quizzes/*" } },
          { not: { href_matches: "/login*" } },
          { not: { href_matches: "/setup" } },
        ],
      },
      eagerness: "moderate",
    },
  ],
  // صفحات الحساب ولوحة التحكم: تُجلب لحظة لمس الرابط فقط، فتصل أسرع وتبقى حديثة
  prefetch: [
    {
      where: {
        and: [
          { href_matches: "/*" },
          { not: { href_matches: "/files/*" } },
          { not: { href_matches: "/attempts/*/upload" } },
          { not: { href_matches: "/login*" } },
          { not: { href_matches: "/setup" } },
        ],
      },
      eagerness: "conservative",
    },
  ],
};

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/health") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    // يتأكد أن قاعدة البيانات متصلة وأن الجداول موجودة، ويقيس زمن الرحلة إليها
    let database = "ok";
    let dbMs: number | null = null;
    let dbRegion: string | null = null;
    try {
      const t0 = Date.now();
      const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").all();
      await env.DB.prepare("SELECT 1").first();
      await env.DB.prepare("SELECT 1").first();
      dbMs = Math.round((Date.now() - t0) / 3);
      dbRegion = r.meta.served_by_region ?? r.meta.served_by ?? null;
    } catch {
      database = "error";
    }
    const cf = (request as unknown as { cf?: { colo?: string; country?: string } }).cf;
    return json(
      {
        status: database === "ok" ? "ok" : "degraded",
        environment: env.APP_ENV,
        database,
        // للتشخيص: مركز Cloudflare الذي خدم الطلب، وزمن رحلة واحدة إلى قاعدة البيانات
        colo: cf?.colo ?? null,
        country: cf?.country ?? null,
        db_ms: dbMs,
        db_region: dbRegion,
      },
      database === "ok" ? 200 : 503,
    );
  }
  return json({ error: "not_found" }, 404);
}

async function publicRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, url, view } = ctx;
  const db = ctx.env.DB;
  // الأستاذ يرى المسودات أيضًا (معاينة)، والبقية يرون المنشور فقط
  const isAdmin = isTeacherView(view);
  if (path === "/") return page(homePage(view, await listPrograms(db)));
  if (path === "/levels") return page(levelsPage(view, await listPrograms(db)));
  if (path === "/subscribe") {
    const id = url.searchParams.get("lesson") ?? "";
    const found = /^\d{1,12}$/.test(id) ? await getLesson(db, Number(id)) : null;
    const locked = found && isPublished(found) && !found.lesson.free ? { program: found.program, lesson: found.lesson } : undefined;
    return page(subscribePage(view, await getSettings(db), locked));
  }
  const programMatch = /^\/levels\/([a-z0-9-]+)$/.exec(path);
  if (programMatch) {
    const data = await programWithUnits(db, programMatch[1] ?? "", { drafts: isAdmin });
    if (!data) return page(notFoundPage(view), 404);
    return page(programPage(view, data.program, data.units));
  }
  const lessonMatch = /^\/lessons\/(\d{1,12})$/.exec(path);
  if (lessonMatch) {
    const found = await getLesson(db, Number(lessonMatch[1]));
    if (!found || (!isPublished(found) && !isAdmin)) return page(notFoundPage(view), 404);
    // المدفوع لا يُعرض أبدًا لمن لا يحق له: يُحوَّل إلى صفحة الاشتراك، ولا يصل إليه معرّف الفيديو
    if (!mayOpen(ctx, found)) return redirect(`/subscribe?lesson=${found.lesson.id}`, [], 302);
    if (found.lesson.kind === "quiz") return quizIntro(ctx, found);
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

function mayOpen(ctx: Ctx, c: LessonContext): boolean {
  return canOpen(ctx.view.access ?? NO_ACCESS, { free: c.lesson.free, program_slug: c.program.slug, visible_since: visibleSince(c.lesson, c.unit) });
}

/** ملف PDF لدرس: نفس قواعد الدرس (منشور، ومن يحق له)، وحسب طريقة الإتاحة التي اختارها الأستاذ. */
async function serveFile(ctx: Ctx, id: number): Promise<Response> {
  const { view } = ctx;
  const isAdmin = isTeacherView(view);
  const found = await getLesson(ctx.env.DB, id);
  if (!found || found.lesson.kind !== "pdf" || !found.lesson.file_key || (!isPublished(found) && !isAdmin)) {
    return page(notFoundPage(view), 404);
  }
  if (!mayOpen(ctx, found)) return redirect(`/subscribe?lesson=${id}`, [], 302);
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
  // ما يحق لمن يتصفح فتحه: الأستاذ كل شيء، والابن اشتراكاته، والولي اشتراكات كل أبنائه
  let access: Access = { ...NO_ACCESS, now };
  if (user) {
    viewer = { name: user.account.name, role: user.account.role, profile: null };
    // معاينة «تلميذ غير مشترك»: لا يُفتح إلا المجاني
    if (user.account.role === "admin") access = user.session.preview === "free" ? { ...NO_ACCESS, now } : { all: true, subs: [], now };
    if (user.account.role === "parent" && user.session.profile_kind === "parent") {
      viewer.profile = "parent";
      access = { all: false, subs: (await accessStatement(env.DB, { accountId: user.account.id }, now).all<Access["subs"][number]>()).results, now };
    }
    if (user.account.role === "parent" && user.session.profile_kind === "student" && user.session.student_id !== null) {
      // اسم الابن واشتراكاته في رحلة واحدة. ابن موقوف أو محذوف يعني أن الملف لم يعد صالحًا
      const [studentRes, subsRes] = await env.DB.batch([
        env.DB.prepare("SELECT * FROM students WHERE id = ? AND account_id = ? AND status = 'active'").bind(user.session.student_id, user.account.id),
        accessStatement(env.DB, { studentId: user.session.student_id }, now),
      ]);
      const student = studentRes?.results[0] as unknown as Student | undefined;
      if (student) {
        viewer = { ...viewer, name: student.name, profile: "student" };
        access = { all: false, subs: (subsRes?.results ?? []) as Access["subs"], now };
      }
    }
  }
  const preview = user?.account.role === "admin" && (user.session.preview === "subscribed" || user.session.preview === "free") ? user.session.preview : null;
  const themeCookie = readCookies(request).get(THEME_COOKIE);
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : null;
  const view: View = { env: env.APP_ENV, viewer, access, preview, path, theme };

  if (method === "POST" && !isSameOrigin(request)) {
    return page(messagePage(view, "طلب مرفوض", "أُرسل هذا النموذج من خارج الموقع، فرُفض حمايةً لحسابك.", "error"), 403);
  }

  const ctx: Ctx = { request, env, url, path, method, now, current, user, view };

  const accountArea =
    path.startsWith("/admin") || path === "/account" || path.startsWith("/account/") || path === "/home" || path === "/profiles" || path.startsWith("/profiles/") || path.startsWith("/attempts/") || path.startsWith("/quizzes/");
  // من يدخل بكلمة مرور مؤقتة يجب أن يغيّرها قبل أي شيء آخر في حسابه
  if (user?.account.must_change_password && accountArea && path !== "/account/password") {
    return redirect("/account/password");
  }
  // كلمة مرور العائلة يغيّرها الولي فقط، لا من ملف أحد الأبناء
  if (user?.account.role === "parent" && viewer?.profile === "student" && path === "/account/password") {
    return redirect("/home");
  }

  // الوضع الليلي والنهاري بدون JavaScript: يقلب الوضع الحالي ويحفظه في كعكة
  if (path === "/theme" && method === "POST") {
    const form = await readForm(request);
    const next = theme === "dark" ? "light" : "dark";
    return redirect(safeNext(field(form, "back"), "/"), [`${THEME_COOKIE}=${next}; Path=/; Secure; SameSite=Lax; Max-Age=31536000`]);
  }

  if (path === "/preview" && method === "POST") {
    if (user?.account.role !== "admin") return page(notFoundPage(view), 404);
    const form = await readForm(request);
    const mode = field(form, "mode");
    await env.DB.prepare("UPDATE sessions SET preview = ? WHERE id = ?").bind(mode === "subscribed" || mode === "free" ? mode : null, user.session.id).run();
    return redirect(safeNext(field(form, "back"), "/"));
  }

  const routed = (await handleAuthRoutes(ctx)) ?? (await handleAdminRoutes(ctx)) ?? (await handleFamilyRoutes(ctx)) ?? (await handleQuizRoutes(ctx));
  if (routed) return routed;

  if (method === "POST") return page(notFoundPage(view), 404);
  const pub = await publicRoutes(ctx);
  if (pub) return pub;

  const asset = await env.ASSETS.fetch(request);
  if (asset.status === 404) return page(notFoundPage(view), 404);
  return asset;
}

export default { fetch: handleRequest };
