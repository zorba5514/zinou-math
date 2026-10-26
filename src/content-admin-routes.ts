// مسارات إدارة المحتوى (للأستاذ فقط؛ التحقق من الصلاحية في admin-routes.ts قبل الوصول إلى هنا).

import { audit, type D1Database, type D1PreparedStatement } from "./db.ts";
import { field, page, readForm, readUpload, redirect } from "./http.ts";
import { randomToken } from "./crypto.ts";
import { deleteQuizzes } from "./quiz.ts";
import { getProgram, listPrograms, programUnits, type Lesson, type Program, type Unit } from "./content.ts";
import { contentHomePage, lessonAdminPage, programAdminPage, unitAdminPage } from "./content-admin-pages.ts";
import { PLAYLIST_ERRORS, parsePlaylistId, parseVideoId, playlistVideos, videoTitle, type PlaylistVideo } from "./youtube.ts";
import { notFoundPage } from "./pages.ts";
import type { Ctx } from "./auth-routes.ts";

const MAX_PASTE = 40;
/** أكبر حجم لملف PDF: 20 ميغابايت. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const FILE_MODES = ["view", "download", "both"] as const;

function adminId(ctx: Ctx): number {
  return ctx.user?.account.id ?? 0;
}

function notFound(ctx: Ctx): Response {
  return page(notFoundPage(ctx.view), 404);
}

export async function handleContentRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  if (path === "/admin/content") return method === "GET" ? contentHome(ctx) : null;
  if (path === "/admin/content/courses" && method === "POST") return addCourse(ctx);

  const prog = /^\/admin\/content\/([a-z0-9-]+)(?:\/(units|edit|delete))?$/.exec(path);
  if (prog) {
    const program = await getProgram(ctx.env.DB, prog[1] ?? "");
    if (!program) return notFound(ctx);
    const action = prog[2];
    if (!action && method === "GET") return showProgram(ctx, program);
    if (method === "POST" && action === "units") return addUnit(ctx, program);
    if (method === "POST" && action === "edit" && program.kind === "course") return editCourse(ctx, program);
    if (method === "POST" && action === "delete" && program.kind === "course") return deleteCourse(ctx, program);
    return notFound(ctx);
  }

  const unitMatch = /^\/admin\/units\/(\d{1,12})(?:\/([a-z-]+))?$/.exec(path);
  if (unitMatch) {
    const unit = await ctx.env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(Number(unitMatch[1])).first<Unit>();
    if (!unit) return notFound(ctx);
    const program = await getProgram(ctx.env.DB, unit.program_slug);
    if (!program) return notFound(ctx);
    const action = unitMatch[2];
    if (!action && method === "GET") return showUnit(ctx, program, unit);
    if (method === "POST") {
      if (action === "edit") return editUnit(ctx, program, unit);
      if (action === "status") return toggleUnit(ctx, unit);
      if (action === "move") return moveUnit(ctx, unit);
      if (action === "delete") return deleteUnit(ctx, program, unit);
      if (action === "playlist") return importPlaylist(ctx, program, unit);
      if (action === "videos") return pasteVideos(ctx, program, unit);
      if (action === "publish-all") return publishAll(ctx, unit);
      if (action === "pdf") return uploadPdf(ctx, program, unit);
      if (action === "quiz") return addQuiz(ctx, program, unit);
    }
    return notFound(ctx);
  }

  const lessonMatch = /^\/admin\/lessons\/(\d{1,12})(?:\/([a-z-]+))?$/.exec(path);
  if (lessonMatch) {
    const lesson = await ctx.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(Number(lessonMatch[1])).first<Lesson>();
    if (!lesson) return notFound(ctx);
    const unit = await ctx.env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(lesson.unit_id).first<Unit>();
    const program = unit ? await getProgram(ctx.env.DB, unit.program_slug) : null;
    if (!unit || !program) return notFound(ctx);
    const action = lessonMatch[2];
    if (!action && method === "GET") return showLesson(ctx, program, unit, lesson);
    if (method === "POST") {
      if (action === "edit") return editLesson(ctx, program, unit, lesson);
      if (action === "free") return toggleLesson(ctx, lesson, "free");
      if (action === "status") return toggleLesson(ctx, lesson, "status");
      if (action === "move") return moveLesson(ctx, lesson);
      if (action === "delete") return deleteLesson(ctx, lesson);
    }
    return notFound(ctx);
  }
  return null;
}

// ---------- المستويات والدورات ----------

async function contentHome(ctx: Ctx): Promise<Response> {
  return page(contentHomePage(ctx.view, await listPrograms(ctx.env.DB, { drafts: true }), { done: ctx.url.searchParams.get("done") }));
}

function validTitle(title: string, max: number): boolean {
  return title.length >= 2 && title.length <= max;
}

async function addCourse(ctx: Ctx): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const title = field(form, "title");
  const iconName = ["trophy", "calculator", "level"].includes(field(form, "icon")) ? field(form, "icon") : "trophy";
  if (!validTitle(title, 80)) {
    return page(contentHomePage(ctx.view, await listPrograms(db, { drafts: true }), { errors: { title: "اكتب اسم الدورة (حرفان على الأقل)." }, values: { title, icon: iconName } }), 400);
  }
  const slug = `course-${ctx.now.toString(36)}`;
  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM programs").first<{ n: number }>();
  await db
    .prepare("INSERT INTO programs (slug, kind, title, short, icon, position, created_at, updated_at) VALUES (?, 'course', ?, 'دورة', ?, ?, ?, ?)")
    .bind(slug, title, iconName, pos?.n ?? 1, ctx.now, ctx.now)
    .run();
  await audit(db, adminId(ctx), "course.added", `program:${slug}`, title);
  return redirect(`/admin/content/${slug}?done=course-added`);
}

async function editCourse(ctx: Ctx, program: Program): Promise<Response> {
  const form = await readForm(ctx.request);
  const title = field(form, "title");
  if (!validTitle(title, 80)) return showProgram(ctx, program, { errors: { course_title: "اكتب اسم الدورة." }, values: { course_title: title } }, 400);
  await ctx.env.DB.prepare("UPDATE programs SET title = ?, updated_at = ? WHERE slug = ?").bind(title, ctx.now, program.slug).run();
  await audit(ctx.env.DB, adminId(ctx), "course.updated", `program:${program.slug}`, title);
  return redirect(`/admin/content/${program.slug}?done=course-saved`);
}

async function deleteCourse(ctx: Ctx, program: Program): Promise<Response> {
  const db = ctx.env.DB;
  const used = await db.prepare("SELECT COUNT(*) AS n FROM units WHERE program_slug = ?").bind(program.slug).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) return redirect(`/admin/content/${program.slug}`);
  await db.prepare("DELETE FROM programs WHERE slug = ? AND kind = 'course'").bind(program.slug).run();
  await audit(db, adminId(ctx), "course.deleted", `program:${program.slug}`, program.title);
  return redirect("/admin/content?done=course-deleted");
}

async function showProgram(
  ctx: Ctx,
  program: Program,
  extra: { errors?: Record<string, string>; values?: Record<string, string> } = {},
  status = 200,
): Promise<Response> {
  const units = await programUnits(ctx.env.DB, program.slug, { drafts: true });
  return page(
    programAdminPage(ctx.view, program, units, { done: ctx.url.searchParams.get("done"), hasKey: Boolean(ctx.env.YOUTUBE_API_KEY), ...extra }),
    status,
  );
}

// ---------- المقاطع ----------

async function addUnit(ctx: Ctx, program: Program): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const title = field(form, "title");
  const playlistText = field(form, "playlist");
  const errors: Record<string, string> = {};
  if (!validTitle(title, 120)) errors.title = "اكتب العنوان (حرفان على الأقل).";
  const playlistId = playlistText ? parsePlaylistId(playlistText) : null;
  if (playlistText && !playlistId) errors.playlist = "هذا ليس رابط قائمة تشغيل. انسخه من صفحة القائمة، ويحتوي على list=";
  if (Object.keys(errors).length) return showProgram(ctx, program, { errors, values: { title, playlist: playlistText } }, 400);

  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM units WHERE program_slug = ?").bind(program.slug).first<{ n: number }>();
  const r = await db
    .prepare("INSERT INTO units (program_slug, title, position, status, playlist_id, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)")
    .bind(program.slug, title, pos?.n ?? 1, playlistId, ctx.now, ctx.now)
    .run();
  const unitId = Number(r.meta.last_row_id);
  await audit(db, adminId(ctx), "unit.added", `unit:${unitId}`, title);
  if (playlistId && ctx.env.YOUTUBE_API_KEY) {
    const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(unitId).first<Unit>();
    if (unit) return runImport(ctx, program, unit, playlistId);
  }
  return redirect(`/admin/units/${unitId}?done=unit-added`);
}

async function showUnit(
  ctx: Ctx,
  program: Program,
  unit: Unit,
  extra: { errors?: Record<string, string>; values?: Record<string, string>; notice?: string | null } = {},
  status = 200,
): Promise<Response> {
  const lessons = await ctx.env.DB.prepare("SELECT * FROM lessons WHERE unit_id = ? ORDER BY position, id").bind(unit.id).all<Lesson>();
  const notice = extra.notice ?? importNotice(ctx.url.searchParams);
  return page(
    unitAdminPage(ctx.view, program, unit, lessons.results, {
      done: ctx.url.searchParams.get("done"),
      hasKey: Boolean(ctx.env.YOUTUBE_API_KEY),
      hasFiles: Boolean(ctx.env.FILES),
      ...extra,
      notice,
    }),
    status,
  );
}

async function editUnit(ctx: Ctx, program: Program, unit: Unit): Promise<Response> {
  const form = await readForm(ctx.request);
  const title = field(form, "title");
  if (!validTitle(title, 120)) return showUnit(ctx, program, unit, { errors: { title: "اكتب العنوان." }, values: { title } }, 400);
  await ctx.env.DB.prepare("UPDATE units SET title = ?, updated_at = ? WHERE id = ?").bind(title, ctx.now, unit.id).run();
  return redirect(`/admin/units/${unit.id}?done=unit-saved`);
}

async function toggleUnit(ctx: Ctx, unit: Unit): Promise<Response> {
  const next = unit.status === "draft" ? "published" : "draft";
  await ctx.env.DB
    .prepare("UPDATE units SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ? WHERE id = ?")
    .bind(next, next, ctx.now, ctx.now, unit.id)
    .run();
  await audit(ctx.env.DB, adminId(ctx), next === "published" ? "unit.published" : "unit.hidden", `unit:${unit.id}`, unit.title);
  return redirect(`/admin/units/${unit.id}?done=${next === "published" ? "unit-published" : "unit-hidden"}`);
}

/** يبدّل موضع عنصر مع جاره (أعلى أو أسفل) داخل نفس المجموعة. */
async function swapWithNeighbour(
  db: D1Database,
  table: "units" | "lessons",
  group: { column: "program_slug" | "unit_id"; value: string | number },
  rowId: number,
  dir: string,
): Promise<void> {
  const rows = (
    await db.prepare(`SELECT id, position FROM ${table} WHERE ${group.column} = ? ORDER BY position, id`).bind(group.value).all<{ id: number; position: number }>()
  ).results;
  const i = rows.findIndex((r) => r.id === rowId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  // ترقيم جديد متتابع بعد التبديل: يصلح أي مواضع متساوية قديمة
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  const changed = rows.map((r, k) => ({ id: r.id, position: k + 1, old: r.position })).filter((r) => r.position !== r.old);
  if (!changed.length) return;
  await db.batch(changed.map((r) => db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).bind(r.position, r.id)));
}

async function moveUnit(ctx: Ctx, unit: Unit): Promise<Response> {
  const form = await readForm(ctx.request);
  await swapWithNeighbour(ctx.env.DB, "units", { column: "program_slug", value: unit.program_slug }, unit.id, field(form, "dir"));
  return redirect(`/admin/content/${unit.program_slug}`);
}

async function deleteUnit(ctx: Ctx, program: Program, unit: Unit): Promise<Response> {
  const form = await readForm(ctx.request);
  if (form.get("confirm") !== "1") return showUnit(ctx, program, unit, { errors: { form: "ضع علامة على «أؤكد الحذف» لحذف المقطع." } }, 400);
  const db = ctx.env.DB;
  const files = await db.prepare("SELECT file_key FROM lessons WHERE unit_id = ? AND file_key IS NOT NULL").bind(unit.id).all<{ file_key: string }>();
  const quizzes = await db.prepare("SELECT quiz_id FROM lessons WHERE unit_id = ? AND quiz_id IS NOT NULL").bind(unit.id).all<{ quiz_id: number }>();
  await deleteQuizzes(db, ctx.env.FILES, quizzes.results.map((q) => q.quiz_id));
  await db.batch([db.prepare("DELETE FROM lessons WHERE unit_id = ?").bind(unit.id), db.prepare("DELETE FROM units WHERE id = ?").bind(unit.id)]);
  if (files.results.length && ctx.env.FILES) await ctx.env.FILES.delete(files.results.map((f) => f.file_key));
  await audit(db, adminId(ctx), "unit.deleted", `unit:${unit.id}`, unit.title);
  return redirect(`/admin/content/${program.slug}?done=unit-deleted`);
}

async function publishAll(ctx: Ctx, unit: Unit): Promise<Response> {
  await ctx.env.DB
    .prepare("UPDATE lessons SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE unit_id = ? AND status = 'draft'")
    .bind(ctx.now, ctx.now, unit.id)
    .run();
  await audit(ctx.env.DB, adminId(ctx), "lessons.published", `unit:${unit.id}`, unit.title);
  return redirect(`/admin/units/${unit.id}?done=all-published`);
}

// ---------- الاستيراد من يوتيوب ----------

/** رسالة نتيجة الاستيراد، تُمرَّر في الرابط بعد التحويل. */
function importNotice(params: URLSearchParams): string | null {
  if (!params.has("added")) return null;
  const added = Number(params.get("added")) || 0;
  const existing = Number(params.get("existing")) || 0;
  const skipped = Number(params.get("skipped")) || 0;
  const invalid = Number(params.get("invalid")) || 0;
  const parts = [added ? `أُضيف ${added} درسًا جديدًا كمسودات.` : "لم يُضف أي درس جديد."];
  if (existing) parts.push(`${existing} موجودة من قبل فلم تتكرر.`);
  if (skipped) parts.push(`${skipped} فيديو خاص أو محذوف تُخطّي.`);
  if (invalid) parts.push(`${invalid} سطرًا ليس رابط فيديو صحيحًا.`);
  return parts.join(" ");
}

/** يضيف الفيديوهات الجديدة في آخر المقطع، ويُرجع عدد ما أُضيف وما كان موجودًا. */
async function addVideos(db: D1Database, unit: Unit, videos: PlaylistVideo[], now: number): Promise<{ added: number; existing: number }> {
  const have = await db.prepare("SELECT youtube_id FROM lessons WHERE unit_id = ? AND youtube_id IS NOT NULL").bind(unit.id).all<{ youtube_id: string }>();
  const seen = new Set(have.results.map((r) => r.youtube_id));
  const fresh: PlaylistVideo[] = [];
  let existing = 0;
  for (const v of videos) {
    if (seen.has(v.id)) existing++;
    else {
      seen.add(v.id);
      fresh.push(v);
    }
  }
  if (!fresh.length) return { added: 0, existing };
  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) AS n FROM lessons WHERE unit_id = ?").bind(unit.id).first<{ n: number }>();
  let p = pos?.n ?? 0;
  const statements: D1PreparedStatement[] = fresh.map((v) =>
    db
      .prepare("INSERT INTO lessons (unit_id, kind, title, position, free, status, youtube_id, created_at, updated_at) VALUES (?, 'video', ?, ?, 0, 'draft', ?, ?, ?)")
      .bind(unit.id, v.title, ++p, v.id, now, now),
  );
  await db.batch(statements);
  return { added: fresh.length, existing };
}

async function runImport(ctx: Ctx, program: Program, unit: Unit, playlistId: string): Promise<Response> {
  const db = ctx.env.DB;
  const result = await playlistVideos(playlistId, ctx.env.YOUTUBE_API_KEY);
  if (!result.ok) {
    return showUnit(ctx, program, unit, { errors: { playlist: PLAYLIST_ERRORS[result.error] }, values: { playlist: `https://www.youtube.com/playlist?list=${playlistId}` } }, 400);
  }
  const { added, existing } = await addVideos(db, unit, result.videos, ctx.now);
  await db.prepare("UPDATE units SET playlist_id = ?, playlist_synced_at = ?, updated_at = ? WHERE id = ?").bind(playlistId, ctx.now, ctx.now, unit.id).run();
  await audit(db, adminId(ctx), "playlist.imported", `unit:${unit.id}`, `${added} جديد`);
  return redirect(`/admin/units/${unit.id}?added=${added}&existing=${existing}&skipped=${result.skipped}`);
}

async function importPlaylist(ctx: Ctx, program: Program, unit: Unit): Promise<Response> {
  const form = await readForm(ctx.request);
  const text = field(form, "playlist");
  const playlistId = parsePlaylistId(text);
  if (!playlistId) {
    return showUnit(ctx, program, unit, { errors: { playlist: "هذا ليس رابط قائمة تشغيل. انسخه من صفحة القائمة، ويحتوي على list=" }, values: { playlist: text } }, 400);
  }
  return runImport(ctx, program, unit, playlistId);
}

async function pasteVideos(ctx: Ctx, program: Program, unit: Unit): Promise<Response> {
  const form = await readForm(ctx.request);
  const text = form.get("links") ?? "";
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return showUnit(ctx, program, unit, { errors: { links: "الصق رابط فيديو واحدًا على الأقل." } }, 400);
  if (lines.length > MAX_PASTE) {
    return showUnit(ctx, program, unit, { errors: { links: `${lines.length} رابطًا أكثر من الحد (${MAX_PASTE}). قسّمها على دفعتين، أو استعمل قائمة تشغيل.` }, values: { links: text } }, 400);
  }
  const ids: string[] = [];
  let invalid = 0;
  for (const line of lines) {
    const id = parseVideoId(line);
    if (id && !ids.includes(id)) ids.push(id);
    else if (!id) invalid++;
  }
  if (!ids.length) return showUnit(ctx, program, unit, { errors: { links: "لم نجد أي رابط فيديو يوتيوب صحيح." }, values: { links: text } }, 400);
  // العناوين من يوتيوب (بدون مفتاح). إن تعذّر، عنوان مؤقت يعدّله الأستاذ.
  const titles = await Promise.all(ids.map((id) => videoTitle(id)));
  const videos = ids.map((id, i) => ({ id, title: titles[i] ?? "فيديو بلا عنوان (عدّل العنوان)", position: i }));
  const { added, existing } = await addVideos(ctx.env.DB, unit, videos, ctx.now);
  await audit(ctx.env.DB, adminId(ctx), "videos.added", `unit:${unit.id}`, `${added} جديد`);
  return redirect(`/admin/units/${unit.id}?added=${added}&existing=${existing}&skipped=0&invalid=${invalid}`);
}

// ---------- الدروس ----------

async function showLesson(
  ctx: Ctx,
  program: Program,
  unit: Unit,
  lesson: Lesson,
  extra: { errors?: Record<string, string>; values?: Record<string, string> } = {},
  status = 200,
): Promise<Response> {
  const units = await ctx.env.DB.prepare("SELECT * FROM units WHERE program_slug = ? ORDER BY position, id").bind(program.slug).all<Unit>();
  return page(lessonAdminPage(ctx.view, program, unit, lesson, units.results, { done: ctx.url.searchParams.get("done"), ...extra }), status);
}

async function editLesson(ctx: Ctx, program: Program, unit: Unit, lesson: Lesson): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const values = {
    title: field(form, "title"),
    description: (form.get("description") ?? "").trim().slice(0, 1000),
    free: field(form, "free") === "1" ? "1" : "0",
    status: field(form, "status") === "published" ? "published" : "draft",
    unit_id: field(form, "unit_id"),
    file_mode: (FILE_MODES as readonly string[]).includes(field(form, "file_mode")) ? field(form, "file_mode") : (lesson.file_mode ?? "both"),
  };
  const errors: Record<string, string> = {};
  if (!validTitle(values.title, 200)) errors.title = "اكتب عنوان الدرس.";
  // النقل مسموح فقط داخل نفس المستوى أو الدورة
  const target = /^\d+$/.test(values.unit_id)
    ? await db.prepare("SELECT * FROM units WHERE id = ? AND program_slug = ?").bind(Number(values.unit_id), program.slug).first<Unit>()
    : null;
  if (!target) errors.unit_id = "اختر المقطع.";
  else if (target.id !== unit.id && lesson.youtube_id) {
    const dup = await db.prepare("SELECT id FROM lessons WHERE unit_id = ? AND youtube_id = ?").bind(target.id, lesson.youtube_id).first();
    if (dup) errors.unit_id = "هذا الفيديو موجود من قبل في المقطع المختار.";
  }
  if (Object.keys(errors).length || !target) return showLesson(ctx, program, unit, lesson, { errors, values }, 400);

  let position = lesson.position;
  if (target.id !== unit.id) {
    const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM lessons WHERE unit_id = ?").bind(target.id).first<{ n: number }>();
    position = pos?.n ?? 1;
  }
  await db
    .prepare(
      `UPDATE lessons SET title = ?, description = ?, free = ?, status = ?, unit_id = ?, position = ?, file_mode = ?,
         published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ? WHERE id = ?`,
    )
    .bind(values.title, values.description || null, Number(values.free), values.status, target.id, position, lesson.kind === "pdf" ? values.file_mode : null, values.status, ctx.now, ctx.now, lesson.id)
    .run();
  await audit(db, adminId(ctx), "lesson.updated", `lesson:${lesson.id}`, values.title);
  return redirect(`/admin/lessons/${lesson.id}?done=lesson-saved`);
}

async function toggleLesson(ctx: Ctx, lesson: Lesson, what: "free" | "status"): Promise<Response> {
  const db = ctx.env.DB;
  if (what === "free") {
    await db.prepare("UPDATE lessons SET free = ?, updated_at = ? WHERE id = ?").bind(lesson.free ? 0 : 1, ctx.now, lesson.id).run();
  } else {
    const next = lesson.status === "draft" ? "published" : "draft";
    await db
      .prepare("UPDATE lessons SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ? WHERE id = ?")
      .bind(next, next, ctx.now, ctx.now, lesson.id)
      .run();
  }
  return redirect(`/admin/units/${lesson.unit_id}#lessons-title`);
}

async function moveLesson(ctx: Ctx, lesson: Lesson): Promise<Response> {
  const form = await readForm(ctx.request);
  await swapWithNeighbour(ctx.env.DB, "lessons", { column: "unit_id", value: lesson.unit_id }, lesson.id, field(form, "dir"));
  return redirect(`/admin/units/${lesson.unit_id}#lessons-title`);
}

async function deleteLesson(ctx: Ctx, lesson: Lesson): Promise<Response> {
  const form = await readForm(ctx.request);
  if (form.get("confirm") !== "1") return redirect(`/admin/lessons/${lesson.id}`);
  if (lesson.quiz_id) await deleteQuizzes(ctx.env.DB, ctx.env.FILES, [lesson.quiz_id]);
  await ctx.env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(lesson.id).run();
  if (lesson.file_key && ctx.env.FILES) await ctx.env.FILES.delete(lesson.file_key);
  await audit(ctx.env.DB, adminId(ctx), "lesson.deleted", `lesson:${lesson.id}`, lesson.title);
  return redirect(`/admin/units/${lesson.unit_id}?done=lesson-deleted`);
}

// ---------- ملفات PDF ----------

async function uploadPdf(ctx: Ctx, program: Program, unit: Unit): Promise<Response> {
  const bucket = ctx.env.FILES;
  if (!bucket) return showUnit(ctx, program, unit, { errors: { pdf: "مخزن الملفات غير مفعّل بعد في Cloudflare." } }, 503);
  const upload = await readUpload(ctx.request, MAX_PDF_BYTES);
  const values = { pdf_title: upload.fields.get("title")?.trim() ?? "", file_mode: upload.fields.get("file_mode") ?? "both" };
  const fail = (message: string, status = 400) => showUnit(ctx, program, unit, { errors: { pdf: message }, values }, status);
  if (upload.tooLarge) return fail("الملف أكبر من 20 ميغابايت. صغّر حجمه (مثلًا بحفظه بجودة أقل) ثم أعد المحاولة.", 413);
  const file = upload.file;
  if (!file) return fail("اختر ملف PDF.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // نتحقق من محتوى الملف نفسه، لا من اسمه فقط: كل ملف PDF يبدأ بـ %PDF-
  const isPdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  if (!isPdf) return fail("هذا الملف ليس PDF.");
  const mode = (FILE_MODES as readonly string[]).includes(values.file_mode) ? values.file_mode : "both";
  const name = (file.name || "ملف.pdf").replace(/[\u0000-\u001f\\/]/g, "").slice(0, 150) || "ملف.pdf";
  const title = values.pdf_title.length >= 2 ? values.pdf_title.slice(0, 200) : name.replace(/\.pdf$/i, "").slice(0, 200) || "ملف PDF";

  const key = `lessons/${unit.id}/${randomToken()}.pdf`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  const db = ctx.env.DB;
  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM lessons WHERE unit_id = ?").bind(unit.id).first<{ n: number }>();
  await db
    .prepare(
      `INSERT INTO lessons (unit_id, kind, title, position, free, status, file_key, file_name, file_size, file_mode, created_at, updated_at)
       VALUES (?, 'pdf', ?, ?, 0, 'draft', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(unit.id, title, pos?.n ?? 1, key, name, bytes.length, mode, ctx.now, ctx.now)
    .run();
  await audit(db, adminId(ctx), "pdf.uploaded", `unit:${unit.id}`, title);
  return redirect(`/admin/units/${unit.id}?done=lesson-added`);
}

// ---------- الاختبارات ----------

async function addQuiz(ctx: Ctx, program: Program, unit: Unit): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const title = field(form, "title");
  if (!validTitle(title, 200)) return showUnit(ctx, program, unit, { errors: { quiz: "اكتب عنوان الاختبار." }, values: { quiz_title: title } }, 400);
  const quiz = await db.prepare("INSERT INTO quizzes (created_at, updated_at) VALUES (?, ?)").bind(ctx.now, ctx.now).run();
  const quizId = Number(quiz.meta.last_row_id);
  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM lessons WHERE unit_id = ?").bind(unit.id).first<{ n: number }>();
  await db
    .prepare("INSERT INTO lessons (unit_id, kind, title, position, free, status, quiz_id, created_at, updated_at) VALUES (?, 'quiz', ?, ?, 0, 'draft', ?, ?, ?)")
    .bind(unit.id, title, pos?.n ?? 1, quizId, ctx.now, ctx.now)
    .run();
  await audit(db, adminId(ctx), "quiz.added", `unit:${unit.id}`, title);
  return redirect(`/admin/quizzes/${quizId}?done=quiz-added`);
}
