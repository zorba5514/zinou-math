// مساحة المستوى في لوحة التحكم: شريط تبويبات للتنقل بين ما يخص المستوى (أو الدورة):
// نظرة عامة · المقاطع · الاختبارات · التلاميذ · النتائج.
// تبويب المقاطع هو صفحة المستوى المعروفة (/admin/content/:slug)، والباقي هنا.

import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, select } from "./ui.ts";
import { adminLayout, when } from "./admin-pages.ts";
import { audit, type D1Database, type D1PreparedStatement } from "./db.ts";
import { field, page, readForm, redirect, safeNext } from "./http.ts";
import { notFoundPage } from "./pages.ts";
import { getProgram, unitWord, type Lesson, type Program, type Unit } from "./content.ts";
import { QUESTION_TYPES, on20, type QuestionType, type Quiz } from "./quiz.ts";
import { subscriptionStatus, type SubState, type Subscription } from "./subscriptions.ts";
import { subPill } from "./family-pages.ts";
import type { Ctx } from "./auth-routes.ts";

export type LevelTab = "overview" | "units" | "tests" | "students" | "results";

export interface TabCounts {
  units: number;
  tests: number;
  students: number;
  pending: number;
}

/** شرط «تلاميذ هذا البرنامج»: المستوى بمستوى التلميذ، والدورة بمن اشترك فيها. */
function studentsWhere(program: Program): string {
  return program.kind === "level" ? "s.level = ?1" : "s.id IN (SELECT student_id FROM subscriptions WHERE program_slug = ?1)";
}

export async function tabCounts(db: D1Database, program: Program): Promise<TabCounts> {
  const [u, t, s, p] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM units WHERE program_slug = ?1").bind(program.slug),
    db.prepare("SELECT COUNT(*) AS n FROM lessons l JOIN units u ON u.id = l.unit_id WHERE u.program_slug = ?1 AND l.kind = 'quiz'").bind(program.slug),
    db.prepare(`SELECT COUNT(*) AS n FROM students s WHERE s.status = 'active' AND ${studentsWhere(program)}`).bind(program.slug),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM attempts t JOIN lessons l ON l.quiz_id = t.quiz_id JOIN units u ON u.id = l.unit_id
         WHERE u.program_slug = ?1 AND (t.status = 'submitted' OR t.ai_review = 1)`,
      )
      .bind(program.slug),
  ]);
  const n = (r: typeof u) => Number((r?.results[0] as { n?: number } | undefined)?.n ?? 0);
  return { units: n(u), tests: n(t), students: n(s), pending: n(p) };
}

/** رأس الصفحة وشريط التبويبات، مشترك بين كل تبويبات المستوى. */
export function levelHeader(program: Program, current: LevelTab, c: TabCounts): Raw {
  const base = `/admin/content/${program.slug}`;
  const tabs: [LevelTab, string, string, Raw | string][] = [
    ["overview", `${base}/overview`, "نظرة عامة", ""],
    ["units", base, program.kind === "level" ? "المقاطع" : "الأجزاء", html`<span class="tab-count">${c.units}</span>`],
    ["tests", `${base}/tests`, "الاختبارات", html`<span class="tab-count">${c.tests}</span>`],
    ["students", `${base}/students`, "التلاميذ", html`<span class="tab-count">${c.students}</span>`],
    ["results", `${base}/results`, "النتائج", c.pending ? html`<span class="tab-count tab-count-alert">${c.pending}</span>` : ""],
  ];
  return html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/admin/content">المحتوى</a><span aria-hidden="true">/</span><span aria-current="page">${program.title}</span></nav>
<header class="page-head page-head-row">
  <h1>${program.title}</h1>
  <a class="btn btn-secondary btn-sm" href="/levels/${program.slug}">${icon("eye")}معاينة في الموقع</a>
</header>
<nav class="tabs" aria-label="أقسام ${program.title}">${tabs.map(
    ([key, href, label, count]) =>
      html`<a class="tab${key === current ? " is-active" : ""}" href="${href}"${key === current ? html` aria-current="page"` : ""}>${label}${count}</a>`,
  )}</nav>`;
}

// ---------- المسارات ----------

export async function handleLevelWorkspace(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  const m = /^\/admin\/content\/([a-z0-9-]+)\/(overview|tests|students|results|quizzes)$/.exec(path);
  if (m) {
    const program = await getProgram(ctx.env.DB, m[1] ?? "");
    if (!program) return page(notFoundPage(ctx.view), 404);
    const tab = m[2]!;
    if (tab === "quizzes") return method === "POST" ? newTest(ctx, program) : null;
    if (method !== "GET") return null;
    if (tab === "overview") return overview(ctx, program);
    if (tab === "tests") return tests(ctx, program);
    if (tab === "students") return students(ctx, program);
    return results(ctx, program);
  }
  const dup = /^\/admin\/quizzes\/(\d{1,12})\/duplicate$/.exec(path);
  if (dup && method === "POST") return duplicateQuiz(ctx, Number(dup[1]));
  const mv = /^\/admin\/lessons\/(\d{1,12})\/unit$/.exec(path);
  if (mv && method === "POST") return moveToUnit(ctx, Number(mv[1]));
  return null;
}

/** ينشئ اختبارًا فارغًا كدرس مسودة في آخر المقطع. يُرجع رقم الاختبار. */
export async function createQuiz(db: D1Database, unitId: number, title: string, now: number): Promise<number> {
  const quiz = await db.prepare("INSERT INTO quizzes (created_at, updated_at) VALUES (?, ?)").bind(now, now).run();
  const quizId = Number(quiz.meta.last_row_id);
  await db
    .prepare(
      `INSERT INTO lessons (unit_id, kind, title, position, free, status, quiz_id, created_at, updated_at)
       VALUES (?1, 'quiz', ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM lessons WHERE unit_id = ?1), 0, 'draft', ?3, ?4, ?4)`,
    )
    .bind(unitId, title, quizId, now)
    .run();
  return quizId;
}

async function programUnitList(db: D1Database, slug: string): Promise<Unit[]> {
  return (await db.prepare("SELECT * FROM units WHERE program_slug = ? ORDER BY position").bind(slug).all<Unit>()).results;
}

// ---------- الاختبارات ----------

interface TestRow {
  lesson_id: number;
  quiz_id: number;
  title: string;
  status: "draft" | "published";
  free: number;
  unit_id: number;
  unit_title: string;
  allow_upload: number;
  time_limit: number | null;
  questions: number;
  types: string | null;
  total: number;
  attempts: number;
  pending: number;
  avg20: number | null;
}

async function tests(ctx: Ctx, program: Program, extra: { errors?: Record<string, string>; values?: Record<string, string> } = {}, status = 200): Promise<Response> {
  const db = ctx.env.DB;
  const [counts, units, rowsRes] = await Promise.all([
    tabCounts(db, program),
    programUnitList(db, program.slug),
    db
      .prepare(
        `SELECT l.id AS lesson_id, l.quiz_id, l.title, l.status, l.free, u.id AS unit_id, u.title AS unit_title, q.allow_upload, q.time_limit,
           (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS questions,
           (SELECT GROUP_CONCAT(DISTINCT type) FROM questions WHERE quiz_id = q.id) AS types,
           (SELECT COALESCE(SUM(points), 0) FROM questions WHERE quiz_id = q.id) AS total,
           (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND status != 'in_progress') AS attempts,
           (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND (status = 'submitted' OR ai_review = 1)) AS pending,
           (SELECT AVG(score * 20.0 / max_score) FROM attempts WHERE quiz_id = q.id AND status = 'graded' AND max_score > 0) AS avg20
         FROM lessons l JOIN units u ON u.id = l.unit_id JOIN quizzes q ON q.id = l.quiz_id
         WHERE u.program_slug = ? AND l.kind = 'quiz' ORDER BY u.position, l.position`,
      )
      .bind(program.slug)
      .all<TestRow>(),
  ]);
  const all = rowsRes.results;
  const statusFilter = ctx.url.searchParams.get("status");
  const unitFilter = Number(ctx.url.searchParams.get("unit")) || 0;
  const rows = all.filter((r) => (statusFilter === "draft" || statusFilter === "published" ? r.status === statusFilter : true) && (unitFilter ? r.unit_id === unitFilter : true));
  const e = extra.errors ?? {};
  const done = ctx.url.searchParams.get("done");
  const base = `/admin/content/${program.slug}/tests`;
  const q = (s: string | null, u: number) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (u) p.set("unit", String(u));
    const str = p.toString();
    return str ? `${base}?${str}` : base;
  };
  const back = q(statusFilter, unitFilter);
  const word = unitWord(program) === "المقطع" ? "مقطع" : "جزء";
  const unitOptions = units.map((u, i) => ({ value: String(u.id), label: `${i + 1}. ${u.title}` }));

  return page(
    adminLayout(
      ctx.view,
      `الاختبارات: ${program.title}`,
      "content",
      html`${levelHeader(program, "tests", counts)}
${alertBox(done === "moved" ? `نُقل الاختبار إلى ${word} آخر.` : done === "deleted" ? "حُذف الاختبار مع أسئلته ومحاولاته." : null, "success")}
<div class="toolbar">
  <div class="chips" role="group" aria-label="الحالة">
    ${[
      [null, "الكل", all.length],
      ["published", "منشور", all.filter((r) => r.status === "published").length],
      ["draft", "مسودة", all.filter((r) => r.status === "draft").length],
    ].map(
      ([s, label, n]) =>
        html`<a class="chip${(statusFilter ?? null) === s || (!s && statusFilter !== "draft" && statusFilter !== "published") ? " is-active" : ""}" href="${q(s as string | null, unitFilter)}">${label} <span class="chip-n">${String(n)}</span></a>`,
    )}
  </div>
  ${
    units.length > 1
      ? html`<form method="get" action="${base}" class="filter-form">
    ${statusFilter ? html`<input type="hidden" name="status" value="${statusFilter}">` : ""}
    <label class="sr-only" for="f-unit-filter">${unitWord(program)}</label>
    <select id="f-unit-filter" name="unit" class="input input-sm" data-autosubmit>
      <option value="">كل ${program.kind === "level" ? "المقاطع" : "الأجزاء"}</option>
      ${units.map((u, i) => html`<option value="${String(u.id)}"${u.id === unitFilter ? html` selected` : ""}>${i + 1}. ${u.title}</option>`)}
    </select>
    <button class="btn btn-secondary btn-sm no-js-only" type="submit">تصفية</button>
  </form>`
      : ""
  }
  <a class="btn btn-primary btn-sm" href="#new-test">${icon("plus", "icon icon-sm")}اختبار جديد</a>
</div>
${
  rows.length
    ? html`<ul class="test-grid">${rows.map((r) => testCard(r, units, program, back))}</ul>`
    : html`<div class="card empty"><p>${all.length ? "لا اختبار بهذه التصفية." : html`لا اختبارات في ${program.title} بعد. أنشئ الأول من النموذج أدناه، ثم أضف أسئلته أو استوردها من Excel.`}</p></div>`
}
<section class="card form-card section" id="new-test" aria-labelledby="new-test-title">
  <h2 id="new-test-title">اختبار جديد</h2>
  ${
    units.length
      ? html`<form method="post" action="/admin/content/${program.slug}/quizzes" class="form" novalidate>
    ${input({ name: "title", id: "f-test-title", label: "عنوان الاختبار", value: extra.values?.title, required: true, maxlength: 200, error: e.title, hint: "مثال: الفرض الأول للفصل الأول" })}
    ${select({ name: "unit_id", id: "f-test-unit", label: `يُرفق بـ${unitWord(program)}`, options: unitOptions, value: extra.values?.unit_id ?? (unitFilter ? String(unitFilter) : undefined), error: e.unit_id })}
    <button class="btn btn-primary btn-sm" type="submit">${icon("plus", "icon icon-sm")}إنشاء ومتابعة إلى الأسئلة</button>
  </form>`
      : html`<p class="muted">الاختبار يُرفق بـ${word}. <a href="/admin/content/${program.slug}">أضف ${word}ًا أولًا</a>.</p>`
  }
</section>`,
    ),
    status,
  );
}

function testCard(r: TestRow, units: Unit[], program: Program, back: string): Raw {
  const types = (r.types ?? "").split(",").filter(Boolean) as QuestionType[];
  const manual = Boolean(r.allow_upload) || types.includes("open");
  const unitIndex = units.findIndex((u) => u.id === r.unit_id);
  return html`<li class="card test-card">
  <div class="test-badges">
    <span class="pill ${r.status === "draft" ? "pill-muted" : "pill-success"}">${r.status === "draft" ? "مسودة" : "منشور"}</span>
    <span class="pill ${manual ? "pill-warning" : "pill-muted"}">${manual ? "يحتاج تصحيحك" : "مصحَّح آليًا"}</span>
    ${r.free ? html`<span class="pill pill-muted">مجاني</span>` : ""}
    ${r.time_limit ? html`<span class="pill pill-muted">${icon("clock", "icon icon-sm")}${r.time_limit} د</span>` : ""}
  </div>
  <h3><a href="/admin/quizzes/${String(r.quiz_id)}">${r.title}</a></h3>
  <p class="muted small">${icon("link", "icon icon-sm")}مرتبط بـ: <a href="/admin/units/${String(r.unit_id)}">${unitIndex >= 0 ? `${unitIndex + 1}. ` : ""}${r.unit_title}</a></p>
  <dl class="test-facts">
    <div><dt>الأسئلة</dt><dd>${r.questions}</dd></div>
    <div><dt>النقاط</dt><dd>${String(Math.round(r.total * 100) / 100).replace(".", ",")}</dd></div>
    <div><dt>المحاولات</dt><dd>${r.attempts}</dd></div>
    <div><dt>المعدل</dt><dd>${r.avg20 === null ? "—" : html`<bdi dir="ltr">${String(Math.round(r.avg20 * 4) / 4).replace(".", ",")}/20</bdi>`}</dd></div>
  </dl>
  ${types.length ? html`<p class="test-types">${types.map((t) => html`<span class="pill pill-muted">${QUESTION_TYPES[t] ?? t}</span>`)}</p>` : html`<p class="muted small">لا أسئلة بعد.</p>`}
  <div class="test-actions">
    <a class="btn btn-secondary btn-xs" href="/admin/quizzes/${String(r.quiz_id)}">${icon("pencil", "icon icon-sm")}تعديل</a>
    <a class="btn btn-secondary btn-xs" href="/lessons/${String(r.lesson_id)}">${icon("eye", "icon icon-sm")}معاينة</a>
    <a class="btn btn-secondary btn-xs" href="/admin/quizzes/${String(r.quiz_id)}/results">${icon("check", "icon icon-sm")}النتائج${r.pending ? html` <span class="pill pill-warning">${r.pending}</span>` : ""}</a>
    <details class="more">
      <summary class="btn btn-secondary btn-xs" aria-label="خيارات أخرى">${icon("more", "icon icon-sm")}</summary>
      <div class="more-menu card">
        <form method="post" action="/admin/quizzes/${String(r.quiz_id)}/duplicate" class="form">
          <button class="btn btn-secondary btn-xs" type="submit">${icon("copy", "icon icon-sm")}نسخ الاختبار</button>
        </form>
        ${
          units.length > 1
            ? html`<form method="post" action="/admin/lessons/${String(r.lesson_id)}/unit" class="form">
          <input type="hidden" name="back" value="${back}">
          <label class="label" for="f-move-${String(r.lesson_id)}">نقل إلى ${unitWord(program)}</label>
          <select id="f-move-${String(r.lesson_id)}" name="unit_id" class="input input-sm">${units.map(
            (u, i) => html`<option value="${String(u.id)}"${u.id === r.unit_id ? html` selected` : ""}>${i + 1}. ${u.title}</option>`,
          )}</select>
          <button class="btn btn-secondary btn-xs" type="submit">نقل</button>
        </form>`
            : ""
        }
        <form method="post" action="/admin/lessons/${String(r.lesson_id)}/delete" class="form">
          <input type="hidden" name="back" value="${back}">
          <label class="check"><input type="checkbox" name="confirm" value="1" required> أؤكد حذف الاختبار ومحاولاته</label>
          <button class="btn btn-danger btn-xs" type="submit">${icon("trash", "icon icon-sm")}حذف</button>
        </form>
      </div>
    </details>
  </div>
</li>`;
}

async function newTest(ctx: Ctx, program: Program): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const title = field(form, "title");
  const unitId = Number(field(form, "unit_id"));
  const errors: Record<string, string> = {};
  if (title.length < 2 || title.length > 200) errors.title = "اكتب عنوان الاختبار.";
  const unit = unitId ? await db.prepare("SELECT * FROM units WHERE id = ? AND program_slug = ?").bind(unitId, program.slug).first<Unit>() : null;
  if (!unit) errors.unit_id = `اختر ${unitWord(program)}.`;
  if (Object.keys(errors).length || !unit) return tests(ctx, program, { errors, values: { title, unit_id: String(unitId || "") } }, 400);
  const quizId = await createQuiz(db, unit.id, title, ctx.now);
  await audit(db, ctx.user?.account.id ?? null, "quiz.added", `unit:${unit.id}`, title);
  return redirect(`/admin/quizzes/${quizId}?done=quiz-added`);
}

/** نسخة مسودة من الاختبار بإعداداته وأسئلته، في نفس المقطع (بدون المحاولات). */
async function duplicateQuiz(ctx: Ctx, quizId: number): Promise<Response> {
  const db = ctx.env.DB;
  const [qRes, lRes] = await db.batch([
    db.prepare("SELECT * FROM quizzes WHERE id = ?").bind(quizId),
    db.prepare("SELECT * FROM lessons WHERE quiz_id = ?").bind(quizId),
  ]);
  const quiz = qRes?.results[0] as unknown as Quiz | undefined;
  const lesson = lRes?.results[0] as unknown as Lesson | undefined;
  if (!quiz || !lesson) return page(notFoundPage(ctx.view), 404);
  const now = ctx.now;
  const created = await db
    .prepare(
      `INSERT INTO quizzes (instructions, time_limit, max_attempts, shuffle_questions, shuffle_choices, results, results_released, allow_upload, created_at, updated_at)
       SELECT instructions, time_limit, max_attempts, shuffle_questions, shuffle_choices, results, 0, allow_upload, ?, ? FROM quizzes WHERE id = ?`,
    )
    .bind(now, now, quizId)
    .run();
  const newId = Number(created.meta.last_row_id);
  const title = `${lesson.title} (نسخة)`.slice(0, 200);
  await db.batch([
    db
      .prepare(
        `INSERT INTO questions (quiz_id, position, type, text, points, data, created_at, updated_at)
         SELECT ?, position, type, text, points, data, ?, ? FROM questions WHERE quiz_id = ? ORDER BY position`,
      )
      .bind(newId, now, now, quizId),
    db
      .prepare(
        `INSERT INTO lessons (unit_id, kind, title, description, position, free, status, quiz_id, created_at, updated_at)
         VALUES (?1, 'quiz', ?2, ?3, (SELECT COALESCE(MAX(position), 0) + 1 FROM lessons WHERE unit_id = ?1), ?4, 'draft', ?5, ?6, ?6)`,
      )
      .bind(lesson.unit_id, title, lesson.description ?? null, lesson.free, newId, now),
  ]);
  await audit(db, ctx.user?.account.id ?? null, "quiz.duplicated", `quiz:${quizId}`, title);
  return redirect(`/admin/quizzes/${newId}?done=duplicated`);
}

/** نقل درس (اختبار أو غيره) إلى مقطع آخر من نفس المستوى، في آخره. */
async function moveToUnit(ctx: Ctx, lessonId: number): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const target = Number(field(form, "unit_id"));
  const row = await db
    .prepare("SELECT l.id, l.unit_id, l.title, u.program_slug FROM lessons l JOIN units u ON u.id = l.unit_id WHERE l.id = ?")
    .bind(lessonId)
    .first<{ id: number; unit_id: number; title: string; program_slug: string }>();
  if (!row) return page(notFoundPage(ctx.view), 404);
  const back = safeNext(field(form, "back"), `/admin/content/${row.program_slug}/tests`);
  const unit = target ? await db.prepare("SELECT id FROM units WHERE id = ? AND program_slug = ?").bind(target, row.program_slug).first<{ id: number }>() : null;
  if (!unit || unit.id === row.unit_id) return redirect(back);
  await db
    .prepare("UPDATE lessons SET unit_id = ?1, position = (SELECT COALESCE(MAX(position), 0) + 1 FROM lessons WHERE unit_id = ?1), updated_at = ?2 WHERE id = ?3")
    .bind(unit.id, ctx.now, lessonId)
    .run();
  await audit(db, ctx.user?.account.id ?? null, "lesson.moved_unit", `lesson:${lessonId}`, row.title);
  return redirect(`${back}${back.includes("?") ? "&" : "?"}done=moved`);
}

// ---------- التلاميذ ----------

interface StudentRow {
  id: number;
  name: string;
  level: string;
  account_id: number;
  parent: string;
  phone: string;
}

const STATE_FILTERS: { key: "all" | SubState | "subscribed"; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "subscribed", label: "مشترك" },
  { key: "due", label: "ينتهي قريبًا" },
  { key: "none", label: "غير مشترك" },
  { key: "suspended", label: "متوقف" },
  { key: "expired", label: "انتهى" },
];

async function studentData(db: D1Database, program: Program, now: number) {
  const [sRes, subRes, aRes] = await db.batch([
    db
      .prepare(
        `SELECT s.id, s.name, s.level, a.id AS account_id, a.name AS parent, a.phone FROM students s JOIN accounts a ON a.id = s.account_id
         WHERE s.status = 'active' AND ${studentsWhere(program)} ORDER BY s.name`,
      )
      .bind(program.slug),
    db.prepare("SELECT * FROM subscriptions WHERE program_slug = ?").bind(program.slug),
    db
      .prepare(
        `SELECT t.student_id, t.score, t.max_score, t.status FROM attempts t JOIN lessons l ON l.quiz_id = t.quiz_id JOIN units u ON u.id = l.unit_id
         WHERE u.program_slug = ? AND t.status != 'in_progress' ORDER BY t.submitted_at DESC LIMIT 2000`,
      )
      .bind(program.slug),
  ]);
  const subs = (subRes?.results ?? []) as unknown as Subscription[];
  const attempts = (aRes?.results ?? []) as unknown as { student_id: number; score: number | null; max_score: number | null; status: string }[];
  return ((sRes?.results ?? []) as unknown as StudentRow[]).map((s) => {
    const mine = attempts.filter((a) => a.student_id === s.id && a.status === "graded" && a.max_score);
    const avg = mine.length ? mine.reduce((sum, a) => sum + ((a.score ?? 0) / a.max_score!) * 20, 0) / mine.length : null;
    return { ...s, status: subscriptionStatus(subs.filter((x) => x.student_id === s.id), program.slug, now), attempts: mine.length, avg };
  });
}

async function students(ctx: Ctx, program: Program): Promise<Response> {
  const db = ctx.env.DB;
  const [counts, list] = await Promise.all([tabCounts(db, program), studentData(db, program, ctx.now)]);
  const filter = STATE_FILTERS.find((f) => f.key === ctx.url.searchParams.get("state"))?.key ?? "all";
  const match = (state: SubState, key: (typeof STATE_FILTERS)[number]["key"]) =>
    key === "all" || state === key || (key === "subscribed" && (state === "active" || state === "due"));
  const rows = list.filter((s) => match(s.status.state, filter));
  const base = `/admin/content/${program.slug}/students`;
  return page(
    adminLayout(
      ctx.view,
      `التلاميذ: ${program.title}`,
      "content",
      html`${levelHeader(program, "students", counts)}
<div class="toolbar">
  <div class="chips" role="group" aria-label="حالة الاشتراك">${STATE_FILTERS.map((f) => {
    const n = list.filter((s) => match(s.status.state, f.key)).length;
    return f.key !== "all" && !n ? "" : html`<a class="chip${f.key === filter ? " is-active" : ""}" href="${f.key === "all" ? base : `${base}?state=${f.key}`}">${f.label} <span class="chip-n">${n}</span></a>`;
  })}</div>
  <a class="btn btn-primary btn-sm" href="/admin/families/new">${icon("userPlus", "icon icon-sm")}إضافة عائلة</a>
</div>
${
  rows.length
    ? html`<ol class="card admin-list student-list">${rows.map(
        (s) => html`<li>
      <span class="initial-avatar" aria-hidden="true">${s.name.slice(0, 1)}</span>
      <a class="admin-list-main" href="/admin/families/${String(s.account_id)}"><strong>${s.name}</strong><small>${s.parent} · <bdi dir="ltr">${s.phone}</bdi>${s.attempts ? html` · ${s.attempts} اختبار · المعدل <bdi dir="ltr">${String(Math.round((s.avg ?? 0) * 4) / 4).replace(".", ",")}/20</bdi>` : ""}</small></a>
      ${subPill(s.status)}
    </li>`,
      )}</ol>`
    : html`<div class="card empty"><p>${list.length ? "لا تلاميذ بهذه الحالة." : program.kind === "level" ? "لا تلاميذ في هذا المستوى بعد. أضف عائلة واختر هذا المستوى لأبنائها." : "لم يشترك أحد في هذه الدورة بعد. فعّل الدورة من صفحة العائلة."}</p></div>`
}`,
    ),
  );
}

// ---------- النتائج ----------

interface ResultRow {
  id: number;
  quiz_id: number;
  status: "submitted" | "graded";
  ai_review: number;
  score: number | null;
  max_score: number | null;
  submitted_at: number;
  student: string;
  quiz: string;
}

async function results(ctx: Ctx, program: Program): Promise<Response> {
  const db = ctx.env.DB;
  const quizFilter = Number(ctx.url.searchParams.get("quiz")) || 0;
  const pendingOnly = ctx.url.searchParams.get("pending") === "1";
  const [counts, quizzes, rowsRes] = await Promise.all([
    tabCounts(db, program),
    db
      .prepare("SELECT l.quiz_id AS id, l.title FROM lessons l JOIN units u ON u.id = l.unit_id WHERE u.program_slug = ? AND l.kind = 'quiz' ORDER BY u.position, l.position")
      .bind(program.slug)
      .all<{ id: number; title: string }>(),
    db
      .prepare(
        `SELECT t.id, t.quiz_id, t.status, t.ai_review, t.score, t.max_score, t.submitted_at, s.name AS student, l.title AS quiz
         FROM attempts t JOIN students s ON s.id = t.student_id JOIN lessons l ON l.quiz_id = t.quiz_id JOIN units u ON u.id = l.unit_id
         WHERE u.program_slug = ?1 AND t.status != 'in_progress' AND (?2 = 0 OR t.quiz_id = ?2) AND (?3 = 0 OR t.status = 'submitted' OR t.ai_review = 1)
         ORDER BY t.submitted_at DESC LIMIT 200`,
      )
      .bind(program.slug, quizFilter, pendingOnly ? 1 : 0)
      .all<ResultRow>(),
  ]);
  const rows = rowsRes.results;
  const base = `/admin/content/${program.slug}/results`;
  return page(
    adminLayout(
      ctx.view,
      `النتائج: ${program.title}`,
      "content",
      html`${levelHeader(program, "results", counts)}
<div class="toolbar">
  <div class="chips" role="group" aria-label="التصفية">
    <a class="chip${pendingOnly ? "" : " is-active"}" href="${quizFilter ? `${base}?quiz=${quizFilter}` : base}">كل المحاولات</a>
    <a class="chip${pendingOnly ? " is-active" : ""}" href="${base}?pending=1${quizFilter ? `&quiz=${quizFilter}` : ""}">تحتاج تصحيحك أو مراجعتك${counts.pending ? html` <span class="chip-n">${counts.pending}</span>` : ""}</a>
  </div>
  ${
    quizzes.results.length > 1
      ? html`<form method="get" action="${base}" class="filter-form">
    ${pendingOnly ? html`<input type="hidden" name="pending" value="1">` : ""}
    <label class="sr-only" for="f-quiz-filter">الاختبار</label>
    <select id="f-quiz-filter" name="quiz" class="input input-sm" data-autosubmit>
      <option value="">كل الاختبارات</option>
      ${quizzes.results.map((q) => html`<option value="${String(q.id)}"${q.id === quizFilter ? html` selected` : ""}>${q.title}</option>`)}
    </select>
    <button class="btn btn-secondary btn-sm no-js-only" type="submit">تصفية</button>
  </form>`
      : ""
  }
</div>
${
  rows.length
    ? html`<ol class="card admin-list">${rows.map(
        (r) => html`<li>
      <a class="admin-list-main" href="/admin/attempts/${String(r.id)}"><strong>${r.student}</strong><small>${r.quiz} · ${when(r.submitted_at)}</small></a>
      ${r.ai_review ? html`<span class="pill pill-ai">${icon("sparkle", "icon icon-sm")}للمراجعة</span>` : ""}
      ${r.status === "submitted" ? html`<span class="pill pill-warning">بانتظار التصحيح</span>` : ""}
      <span class="score-chip"><bdi dir="ltr">${on20(r.score, r.max_score)}/20</bdi></span>
    </li>`,
      )}</ol>`
    : html`<div class="card empty"><p>${pendingOnly ? "لا شيء ينتظرك هنا." : "لم يجتز أحد اختبارات هذا المستوى بعد."}</p></div>`
}`,
    ),
  );
}

// ---------- نظرة عامة ----------

async function overview(ctx: Ctx, program: Program): Promise<Response> {
  const db = ctx.env.DB;
  const [counts, list, lessonsRes, recentRes] = await Promise.all([
    tabCounts(db, program),
    studentData(db, program, ctx.now),
    db
      .prepare(
        `SELECT l.kind, l.status, u.status AS unit_status FROM lessons l JOIN units u ON u.id = l.unit_id WHERE u.program_slug = ?`,
      )
      .bind(program.slug)
      .all<{ kind: string; status: string; unit_status: string }>(),
    db
      .prepare(
        `SELECT t.id, t.status, t.ai_review, t.score, t.max_score, t.submitted_at, s.name AS student, l.title AS quiz
         FROM attempts t JOIN students s ON s.id = t.student_id JOIN lessons l ON l.quiz_id = t.quiz_id JOIN units u ON u.id = l.unit_id
         WHERE u.program_slug = ? AND t.status != 'in_progress' ORDER BY t.submitted_at DESC LIMIT 5`,
      )
      .bind(program.slug)
      .all<ResultRow>(),
  ]);
  const lessons = lessonsRes.results;
  const published = lessons.filter((l) => l.status === "published" && l.unit_status === "published");
  const subscribed = list.filter((s) => s.status.state === "active" || s.status.state === "due").length;
  const due = list.filter((s) => s.status.state === "due").length;
  const suspended = list.filter((s) => s.status.state === "suspended").length;
  const graded = list.filter((s) => s.avg !== null);
  const avg = graded.length ? graded.reduce((a, s) => a + s.avg!, 0) / graded.length : null;
  const kinds = (k: string) => lessons.filter((l) => l.kind === k).length;
  const base = `/admin/content/${program.slug}`;
  return page(
    adminLayout(
      ctx.view,
      `نظرة عامة: ${program.title}`,
      "content",
      html`${levelHeader(program, "overview", counts)}
<ul class="stats stats-4">
  <li class="card stat"><span class="icon-box">${icon("book")}</span><strong>${published.length}</strong><span class="muted">درس منشور من ${lessons.length}</span></li>
  <li class="card stat"><span class="icon-box icon-box-success">${icon("users")}</span><strong>${subscribed}</strong><span class="muted">مشترك من ${list.length} تلميذ</span></li>
  <li class="card stat"><span class="icon-box icon-box-soft">${icon("quiz")}</span><strong>${counts.pending}</strong><span class="muted">محاولة تنتظر تصحيحك</span></li>
  <li class="card stat"><span class="icon-box icon-box-soft">${icon("trophy")}</span><strong>${avg === null ? "—" : html`<bdi dir="ltr">${String(Math.round(avg * 4) / 4).replace(".", ",")}</bdi>`}</strong><span class="muted">معدل التلاميذ على 20</span></li>
</ul>
<div class="overview-grid">
  <section class="card form-card" aria-labelledby="ov-content">
    <h2 id="ov-content">المحتوى</h2>
    <ul class="kv-list">
      <li><span>${program.kind === "level" ? "المقاطع" : "الأجزاء"}</span><a href="${base}">${counts.units}</a></li>
      <li><span>فيديوهات</span><strong>${kinds("video")}</strong></li>
      <li><span>ملفات PDF</span><strong>${kinds("pdf")}</strong></li>
      <li><span>اختبارات</span><a href="${base}/tests">${kinds("quiz")}</a></li>
      <li><span>مسودات لم تُنشر</span><strong>${lessons.length - published.length}</strong></li>
    </ul>
    <div class="actions actions-tight">
      <a class="btn btn-secondary btn-sm" href="${base}#add-unit">${icon("plus", "icon icon-sm")}إضافة ${unitWord(program) === "المقطع" ? "مقطع" : "جزء"}</a>
      <a class="btn btn-secondary btn-sm" href="${base}/tests#new-test">${icon("plus", "icon icon-sm")}اختبار جديد</a>
    </div>
  </section>
  <section class="card form-card" aria-labelledby="ov-students">
    <h2 id="ov-students">الاشتراكات</h2>
    <ul class="kv-list">
      <li><span>مشترك</span><a href="${base}/students?state=subscribed">${subscribed}</a></li>
      <li><span>ينتهي خلال 14 يومًا</span><a href="${base}/students?state=due">${due}</a></li>
      <li><span>متوقف (لم يدفع)</span><a href="${base}/students?state=suspended">${suspended}</a></li>
      <li><span>غير مشترك</span><a href="${base}/students?state=none">${list.filter((s) => s.status.state === "none").length}</a></li>
    </ul>
  </section>
</div>
<section class="section" aria-labelledby="ov-results">
  <h2 id="ov-results">آخر النتائج</h2>
  ${
    recentRes.results.length
      ? html`<ol class="card admin-list">${recentRes.results.map(
          (r) => html`<li>
      <a class="admin-list-main" href="/admin/attempts/${String(r.id)}"><strong>${r.student}</strong><small>${r.quiz} · ${when(r.submitted_at)}</small></a>
      ${r.ai_review ? html`<span class="pill pill-ai">${icon("sparkle", "icon icon-sm")}للمراجعة</span>` : ""}
      ${r.status === "submitted" ? html`<span class="pill pill-warning">بانتظار التصحيح</span>` : ""}
      <span class="score-chip"><bdi dir="ltr">${on20(r.score, r.max_score)}/20</bdi></span>
    </li>`,
        )}</ol>
  <p><a href="${base}/results">كل النتائج ←</a></p>`
      : html`<div class="card empty"><p>لا نتائج بعد. تظهر هنا عندما يجتاز التلاميذ اختبارات هذا المستوى.</p></div>`
  }
</section>`,
    ),
  );
}

