// مسارات اجتياز الاختبار: البدء، والحفظ أولًا بأول، والتسليم، والنتيجة، وملف الحل.
//
// من يحق له:
// - الاجتياز: ملف الابن فقط، وبنفس قواعد فتح الدرس (منشور، ومجاني أو باشتراك).
// - النتيجة: الابن صاحب المحاولة، ووليه، والأستاذ.

import { aiGrader } from "./ai-grade.ts";
import { audit } from "./db.ts";
import { json, page, redirect } from "./http.ts";
import { randomToken } from "./crypto.ts";
import { notFoundPage } from "./pages.ts";
import { getLesson, isPublished, type Lesson, type LessonContext } from "./content.ts";
import { NO_ACCESS, canOpen, visibleSince } from "./subscriptions.ts";
import {
  MAX_UPLOAD_BYTES,
  closeIfExpired,
  finalizeAttempt,
  isOpen,
  loadAnswers,
  loadQuestions,
  loadQuiz,
  makeLayout,
  orderedQuestions,
  readLayout,
  type Attempt,
  type Quiz,
} from "./quiz.ts";
import { attemptPage, quizIntroPage, resultPage, type AttemptSummary } from "./quiz-pages.ts";
import type { Ctx } from "./auth-routes.ts";

const MAX_VALUE = 2000;

/** رقم الابن الذي يستعمل المنصة الآن، أو null (زائر، ولي، أستاذ). */
function currentStudent(ctx: Ctx): number | null {
  if (ctx.view.viewer?.role !== "parent" || ctx.view.viewer.profile !== "student") return null;
  return ctx.user?.session.student_id ?? null;
}

function mayOpen(ctx: Ctx, c: LessonContext): boolean {
  return canOpen(ctx.view.access ?? NO_ACCESS, { free: c.lesson.free, program_slug: c.program.slug, visible_since: visibleSince(c.lesson, c.unit) });
}

async function quizLesson(ctx: Ctx, quizId: number): Promise<{ c: LessonContext; quiz: Quiz } | null> {
  const lesson = await ctx.env.DB.prepare("SELECT * FROM lessons WHERE quiz_id = ?").bind(quizId).first<Lesson>();
  const c = lesson ? await getLesson(ctx.env.DB, lesson.id) : null;
  const quiz = await loadQuiz(ctx.env.DB, quizId);
  return c && quiz ? { c, quiz } : null;
}

// ---------- صفحة التقديم (تُعرض من مسار الدرس /lessons/:id) ----------

export async function quizIntro(ctx: Ctx, c: LessonContext): Promise<Response> {
  const db = ctx.env.DB;
  const quiz = c.lesson.quiz_id ? await loadQuiz(db, c.lesson.quiz_id) : null;
  if (!quiz) return page(notFoundPage(ctx.view), 404);
  const questions = await loadQuestions(db, quiz.id);
  const points = questions.reduce((s, q) => s + q.points, 0);
  const studentId = currentStudent(ctx);
  let attempts: AttemptSummary[] = [];
  let message: string | null = null;

  if (studentId !== null) {
    const rows = (await db.prepare("SELECT * FROM attempts WHERE quiz_id = ? AND student_id = ? ORDER BY started_at DESC").bind(quiz.id, studentId).all<Attempt>()).results;
    for (const r of rows) attempts.push({ attempt: await closeIfExpired(db, quiz, r, ctx.now, aiGrader(ctx.env)) });
  } else if (ctx.view.viewer?.role === "parent" && ctx.view.viewer.profile === "parent" && ctx.user) {
    const rows = (
      await db
        .prepare(
          `SELECT t.*, s.name AS student_name FROM attempts t JOIN students s ON s.id = t.student_id
           WHERE t.quiz_id = ? AND s.account_id = ? ORDER BY t.started_at DESC`,
        )
        .bind(quiz.id, ctx.user.account.id)
        .all<Attempt & { student_name: string }>()
    ).results;
    for (const r of rows) attempts.push({ attempt: await closeIfExpired(db, quiz, r, ctx.now, aiGrader(ctx.env)), student: r.student_name });
    message = "يجتاز الاختبارَ الابنُ من ملفه. هنا تتابع نتائج أبنائك.";
  } else if (ctx.view.viewer?.role === "admin") {
    message = ctx.view.preview
      ? "في وضع «عرض كتلميذ» ترى صفحة الاختبار كما يراها التلميذ، لكن الاجتياز يكون من ملف تلميذ حقيقي."
      : "هذه معاينة. لتعديل الأسئلة أو رؤية النتائج افتح الاختبار من لوحة التحكم.";
  } else if (!ctx.view.viewer) {
    message = "ادخل بحساب العائلة، ثم اختر ملف التلميذ لاجتياز الاختبار.";
  } else {
    message = "اختر ملف التلميذ لاجتياز الاختبار.";
  }

  const inProgress = attempts.find((a) => a.attempt.status === "in_progress" && isOpen(a.attempt, ctx.now))?.attempt ?? null;
  const used = attempts.filter((a) => a.attempt.status !== "in_progress").length;
  let canStart = studentId !== null && questions.length > 0;
  if (studentId !== null && !questions.length) message = "لم يُضف الأستاذ أسئلة لهذا الاختبار بعد.";
  if (studentId !== null && quiz.max_attempts && used >= quiz.max_attempts) {
    canStart = false;
    message = "استعملت كل المحاولات المسموحة لهذا الاختبار.";
  }
  return page(quizIntroPage(ctx.view, c, quiz, { questions: questions.length, points, asStudent: studentId !== null, attempts, inProgress, canStart, message }));
}

// ---------- المسارات ----------

export async function handleQuizRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  const start = /^\/quizzes\/(\d{1,12})\/start$/.exec(path);
  if (start) return method === "POST" ? startAttempt(ctx, Number(start[1])) : null;
  const m = /^\/attempts\/(\d{1,12})(?:\/(save|submit|upload))?$/.exec(path);
  if (!m) return null;
  if (!ctx.user) return method === "GET" ? redirect(`/login?next=${encodeURIComponent(path)}`) : json({ error: "login" }, 401);
  const attempt = await ctx.env.DB.prepare("SELECT * FROM attempts WHERE id = ?").bind(Number(m[1])).first<Attempt>();
  if (!attempt) return page(notFoundPage(ctx.view), 404);
  const found = await quizLesson(ctx, attempt.quiz_id);
  if (!found) return page(notFoundPage(ctx.view), 404);
  const role = await relation(ctx, attempt);
  if (!role) return page(notFoundPage(ctx.view), 404);
  const action = m[2];
  if (!action && method === "GET") return showAttempt(ctx, found.c, found.quiz, attempt, role);
  if (action === "save" && method === "POST") return role === "student" ? saveAnswer(ctx, found.quiz, attempt) : json({ error: "forbidden" }, 403);
  if (action === "submit" && method === "POST") return role === "student" ? submitAttempt(ctx, found.c, found.quiz, attempt) : page(notFoundPage(ctx.view), 404);
  if (action === "upload" && method === "GET") return serveUpload(ctx, attempt);
  return page(notFoundPage(ctx.view), 404);
}

/** علاقة من يتصفح بالمحاولة: صاحبها، أو وليه، أو الأستاذ. */
async function relation(ctx: Ctx, attempt: Attempt): Promise<"student" | "parent" | "admin" | null> {
  if (ctx.view.viewer?.role === "admin") return "admin";
  if (currentStudent(ctx) === attempt.student_id) return "student";
  if (ctx.view.viewer?.profile === "parent" && ctx.user) {
    const own = await ctx.env.DB.prepare("SELECT 1 AS ok FROM students WHERE id = ? AND account_id = ?").bind(attempt.student_id, ctx.user.account.id).first();
    if (own) return "parent";
  }
  return null;
}

async function startAttempt(ctx: Ctx, quizId: number): Promise<Response> {
  const studentId = currentStudent(ctx);
  if (!ctx.user || studentId === null) return redirect(ctx.user ? "/profiles" : "/login");
  const found = await quizLesson(ctx, quizId);
  if (!found || !isPublished(found.c)) return page(notFoundPage(ctx.view), 404);
  if (!mayOpen(ctx, found.c)) return redirect(`/subscribe?lesson=${found.c.lesson.id}`);
  const { quiz } = found;
  const db = ctx.env.DB;
  const questions = await loadQuestions(db, quiz.id);
  if (!questions.length) return redirect(`/lessons/${found.c.lesson.id}`);

  const rows = (await db.prepare("SELECT * FROM attempts WHERE quiz_id = ? AND student_id = ?").bind(quiz.id, studentId).all<Attempt>()).results;
  let used = 0;
  for (const r of rows) {
    const a = await closeIfExpired(db, quiz, r, ctx.now, aiGrader(ctx.env));
    // محاولة جارية: نكملها بدل فتح أخرى
    if (a.status === "in_progress") return redirect(`/attempts/${a.id}`);
    used++;
  }
  if (quiz.max_attempts && used >= quiz.max_attempts) return redirect(`/lessons/${found.c.lesson.id}`);

  const layout = makeLayout(quiz, questions);
  const r = await db
    .prepare("INSERT INTO attempts (quiz_id, student_id, started_at, deadline_at, layout) VALUES (?, ?, ?, ?, ?)")
    .bind(quiz.id, studentId, ctx.now, quiz.time_limit ? ctx.now + quiz.time_limit * 60_000 : null, JSON.stringify(layout))
    .run();
  return redirect(`/attempts/${Number(r.meta.last_row_id)}`);
}

async function showAttempt(ctx: Ctx, c: LessonContext, quiz: Quiz, attemptIn: Attempt, role: "student" | "parent" | "admin"): Promise<Response> {
  const db = ctx.env.DB;
  if (role === "admin") return redirect(`/admin/attempts/${attemptIn.id}`);
  const attempt = await closeIfExpired(db, quiz, attemptIn, ctx.now, aiGrader(ctx.env));
  const layoutData = readLayout(attempt);
  const questions = orderedQuestions(await loadQuestions(db, quiz.id), layoutData);
  const answers = new Map((await loadAnswers(db, attempt.id)).map((a) => [a.question_id, a]));
  if (attempt.status === "in_progress") {
    if (role !== "student") return redirect(`/lessons/${c.lesson.id}`);
    return page(attemptPage(ctx.view, c, quiz, attempt, questions, layoutData, answers, { now: ctx.now, uploads: Boolean(ctx.env.FILES) }));
  }
  const student = role === "parent" ? await db.prepare("SELECT name FROM students WHERE id = ?").bind(attempt.student_id).first<{ name: string }>() : null;
  return page(resultPage(ctx.view, c, quiz, attempt, questions, answers, { student: student?.name, justSubmitted: ctx.url.searchParams.get("done") === "1" }));
}

/** حفظ إجابة سؤال واحد أثناء الاجتياز (يرسله المتصفح عند كل تغيير). */
async function saveAnswer(ctx: Ctx, quiz: Quiz, attempt: Attempt): Promise<Response> {
  if (!isOpen(attempt, ctx.now)) {
    await closeIfExpired(ctx.env.DB, quiz, attempt, ctx.now, aiGrader(ctx.env));
    return json({ error: "closed" }, 409);
  }
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const questionId = Number(form.get("question_id"));
  const value = String(form.get("value") ?? "").slice(0, MAX_VALUE);
  if (!readLayout(attempt).q.includes(questionId)) return json({ error: "bad_question" }, 400);
  await ctx.env.DB
    .prepare(
      `INSERT INTO answers (attempt_id, question_id, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(attempt.id, questionId, value, ctx.now)
    .run();
  return json({ ok: true });
}

async function submitAttempt(ctx: Ctx, c: LessonContext, quiz: Quiz, attempt: Attempt): Promise<Response> {
  const db = ctx.env.DB;
  if (!isOpen(attempt, ctx.now)) {
    // انتهى الوقت: التسليم المتأخر مرفوض، وتُصحَّح الإجابات المحفوظة قبل الموعد
    await closeIfExpired(db, quiz, attempt, ctx.now, aiGrader(ctx.env));
    return redirect(`/attempts/${attempt.id}`);
  }
  const length = Number(ctx.request.headers.get("Content-Length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + 256 * 1024) return showError(ctx, c, quiz, attempt, "ملف الحل أكبر من 5 ميغابايت.");
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return showError(ctx, c, quiz, attempt, "تعذّر قراءة الإجابات. أعد المحاولة.");
  }

  // ملف الحل (اختياري)
  const file = form.get("solution");
  if (quiz.allow_upload && file && typeof file !== "string" && file.size > 0) {
    if (!ctx.env.FILES) return showError(ctx, c, quiz, attempt, "رفع الملفات غير متاح حاليًا.");
    if (file.size > MAX_UPLOAD_BYTES) return showError(ctx, c, quiz, attempt, "ملف الحل أكبر من 5 ميغابايت. صغّر حجمه ثم أعد التسليم.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
    if (!isPdf) return showError(ctx, c, quiz, attempt, "ملف الحل يجب أن يكون PDF.");
    const key = `solutions/${quiz.id}/${attempt.id}-${randomToken()}.pdf`;
    await ctx.env.FILES.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
    if (attempt.upload_key) await ctx.env.FILES.delete(attempt.upload_key);
    const name = (file.name || "حل.pdf").replace(/[\u0000-\u001f\\/]/g, "").slice(0, 150);
    await db.prepare("UPDATE attempts SET upload_key = ?, upload_name = ?, upload_size = ? WHERE id = ?").bind(key, name, bytes.length, attempt.id).run();
  }

  // كل الإجابات في النموذج (تحل محل ما حُفظ)؛ الأسئلة غير المرسلة تبقى كما حُفظت
  const layout = readLayout(attempt);
  const questions = orderedQuestions(await loadQuestions(db, quiz.id), layout);
  const statements = [];
  for (const q of questions) {
    const values = form.getAll(`q_${q.id}`).filter((v): v is string => typeof v === "string");
    if (!values.length && q.type !== "multiple") continue;
    const value = (q.type === "multiple" ? values.join(",") : (values[0] ?? "")).slice(0, MAX_VALUE);
    statements.push(
      db
        .prepare(
          `INSERT INTO answers (attempt_id, question_id, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(attempt.id, q.id, value, ctx.now),
    );
  }
  if (statements.length) await db.batch(statements);
  const fresh = (await db.prepare("SELECT * FROM attempts WHERE id = ?").bind(attempt.id).first<Attempt>()) ?? attempt;
  await finalizeAttempt(db, quiz, fresh, ctx.now, aiGrader(ctx.env));
  await audit(db, ctx.user?.account.id ?? null, "attempt.submitted", `quiz:${quiz.id}`, c.lesson.title);
  return redirect(`/attempts/${attempt.id}?done=1`);
}

async function showError(ctx: Ctx, c: LessonContext, quiz: Quiz, attempt: Attempt, error: string): Promise<Response> {
  const layoutData = readLayout(attempt);
  const questions = orderedQuestions(await loadQuestions(ctx.env.DB, quiz.id), layoutData);
  const answers = new Map((await loadAnswers(ctx.env.DB, attempt.id)).map((a) => [a.question_id, a]));
  return page(attemptPage(ctx.view, c, quiz, attempt, questions, layoutData, answers, { now: ctx.now, uploads: Boolean(ctx.env.FILES), error }), 400);
}

async function serveUpload(ctx: Ctx, attempt: Attempt): Promise<Response> {
  const object = attempt.upload_key && ctx.env.FILES ? await ctx.env.FILES.get(attempt.upload_key) : null;
  if (!object) return page(notFoundPage(ctx.view), 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="solution-${attempt.id}.pdf"; filename*=UTF-8''${encodeURIComponent(attempt.upload_name ?? "solution.pdf")}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

