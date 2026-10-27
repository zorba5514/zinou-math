// إدارة الاختبارات في لوحة التحكم: الإعدادات، والأسئلة، والنتائج، والتصحيح اليدوي.

import { aiGrader } from "./ai-grade.ts";
import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, select, textarea, type View } from "./ui.ts";
import { adminLayout, when } from "./admin-pages.ts";
import { audit, type D1PreparedStatement } from "./db.ts";
import { field, page, readForm, redirect } from "./http.ts";
import { notFoundPage } from "./pages.ts";
import { answerMath, mathText } from "./math.ts";
import { getProgram, type Lesson, type Program, type Unit } from "./content.ts";
import {
  MAX_CHOICES,
  QUESTION_TYPES,
  RESULTS_MODES,
  closeIfExpired,
  formatPoints,
  isCorrect,
  loadAnswers,
  loadQuestions,
  loadQuiz,
  on20,
  normalizeText,
  orderedQuestions,
  questionData,
  readLayout,
  readQuestionForm,
  recomputeScore,
  usesAi,
  type Answer,
  type Attempt,
  type Question,
  type QuestionType,
  type Quiz,
  type ResultsMode,
} from "./quiz.ts";
import { answerView } from "./quiz-pages.ts";
import type { Ctx } from "./auth-routes.ts";

/** صفحات الأسئلة تحتاج KaTeX للمعاينة، ومحرر الأسئلة. */
const EDITOR_SCRIPTS = ["/katex/katex.min.js", "/editor.js"];

interface QuizContext {
  quiz: Quiz;
  lesson: Lesson;
  unit: Unit;
  program: Program;
}

async function loadContext(ctx: Ctx, quizId: number): Promise<QuizContext | null> {
  const db = ctx.env.DB;
  const quiz = await loadQuiz(db, quizId);
  if (!quiz) return null;
  const lesson = await db.prepare("SELECT * FROM lessons WHERE quiz_id = ?").bind(quizId).first<Lesson>();
  if (!lesson) return null;
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(lesson.unit_id).first<Unit>();
  const program = unit ? await getProgram(db, unit.program_slug) : null;
  return unit && program ? { quiz, lesson, unit, program } : null;
}

function adminId(ctx: Ctx): number {
  return ctx.user?.account.id ?? 0;
}

export async function handleQuizAdmin(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  const quizMatch = /^\/admin\/quizzes\/(\d{1,12})(?:\/([a-z-]+))?$/.exec(path);
  if (quizMatch) {
    const c = await loadContext(ctx, Number(quizMatch[1]));
    if (!c) return page(notFoundPage(ctx.view), 404);
    const action = quizMatch[2];
    if (!action && method === "GET") return showEditor(ctx, c);
    if (action === "settings" && method === "POST") return saveSettings(ctx, c);
    if (action === "new") return method === "POST" ? saveQuestion(ctx, c, null) : newQuestion(ctx, c);
    if (action === "results" && method === "GET") return showResults(ctx, c);
    if (action === "release" && method === "POST") return toggleRelease(ctx, c);
    return page(notFoundPage(ctx.view), 404);
  }
  const qMatch = /^\/admin\/questions\/(\d{1,12})(?:\/([a-z-]+))?$/.exec(path);
  if (qMatch) {
    const question = await ctx.env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(Number(qMatch[1])).first<Question>();
    const c = question ? await loadContext(ctx, question.quiz_id) : null;
    if (!question || !c) return page(notFoundPage(ctx.view), 404);
    const action = qMatch[2];
    if (!action) return method === "POST" ? saveQuestion(ctx, c, question) : editQuestion(ctx, c, question);
    if (action === "move" && method === "POST") return moveQuestion(ctx, question);
    if (action === "delete" && method === "POST") return deleteQuestion(ctx, question);
    return page(notFoundPage(ctx.view), 404);
  }
  const aMatch = /^\/admin\/attempts\/(\d{1,12})(?:\/accept\/(\d{1,12}))?$/.exec(path);
  if (aMatch) {
    const attempt = await ctx.env.DB.prepare("SELECT * FROM attempts WHERE id = ?").bind(Number(aMatch[1])).first<Attempt>();
    const c = attempt ? await loadContext(ctx, attempt.quiz_id) : null;
    if (!attempt || !c) return page(notFoundPage(ctx.view), 404);
    if (aMatch[2]) return method === "POST" ? acceptAnswer(ctx, c, attempt, Number(aMatch[2])) : page(notFoundPage(ctx.view), 404);
    return method === "POST" ? saveGrades(ctx, c, attempt) : showAttempt(ctx, c, attempt);
  }
  return null;
}

// ---------- صفحة الاختبار: الإعدادات والأسئلة ----------

const DONE: Record<string, string> = {
  "quiz-added": "أُنشئ الاختبار كمسودة. أضف الأسئلة، ثم انشره من صفحة المقطع.",
  settings: "حُفظت الإعدادات.",
  "q-added": "أُضيف السؤال.",
  "q-saved": "حُفظ السؤال.",
  "q-deleted": "حُذف السؤال.",
  graded: "حُفظ التصحيح.",
  accepted: "أُضيفت الإجابة إلى الإجابات المقبولة، وصُحّحت بها كل المحاولات التي كتبتها.",
  "accept-full": "القائمة ممتلئة (20 إجابة). احذف إجابة من السؤال أولًا.",
  released: "نُشرت النتائج: يراها التلاميذ والأولياء الآن.",
  hidden: "أُخفيت النتائج.",
};

function crumbs(c: QuizContext, last?: string): Raw {
  return html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/admin/content/${c.program.slug}">${c.program.title}</a><span aria-hidden="true">/</span><a href="/admin/units/${String(c.unit.id)}">${c.unit.title}</a><span aria-hidden="true">/</span>${last ? html`<a href="/admin/quizzes/${String(c.quiz.id)}">${c.lesson.title}</a><span aria-hidden="true">/</span><span aria-current="page">${last}</span>` : html`<span aria-current="page">${c.lesson.title}</span>`}</nav>`;
}

function questionPreview(q: Question, showAnswer = true): Raw {
  const d = questionData(q);
  let answer: Raw | string = "";
  if (showAnswer) {
    if (q.type === "single" || q.type === "multiple") {
      answer = html`<ul class="q-choices">${(d.choices ?? []).map(
        (ch) => html`<li class="${(d.correct ?? []).includes(ch.id) ? "q-correct" : ""}">${(d.correct ?? []).includes(ch.id) ? icon("check", "icon icon-sm") : ""}${mathText(ch.text)}</li>`,
      )}</ul>`;
    } else if (q.type === "truefalse") answer = html`<p class="q-key">الإجابة: <strong>${d.answer ? "صح" : "خطأ"}</strong></p>`;
    else if (q.type === "numeric") answer = html`<p class="q-key">الإجابة: ${answerMath(d.value ?? "")}${d.tolerance ? html` (± <bdi dir="ltr">${String(d.tolerance)}</bdi>)` : ""}</p>`;
    else if (q.type === "short") answer = html`<p class="q-key">${d.mode === "math" ? "عبارة رياضية" : "نص"}: ${(d.accepted ?? []).map((a, i) => html`${i ? " · " : ""}${d.mode === "math" ? answerMath(a) : html`<bdi>${a}</bdi>`}`)}</p>`;
    else answer = html`<p class="q-key muted">يصححه الأستاذ</p>`;
  }
  return html`<div class="q-text">${mathText(q.text)}</div>${answer}`;
}

async function showEditor(ctx: Ctx, c: QuizContext, extra: { errors?: Record<string, string> } = {}, status = 200): Promise<Response> {
  const db = ctx.env.DB;
  const questions = await loadQuestions(db, c.quiz.id);
  const counts = await db
    .prepare("SELECT COUNT(*) AS n, SUM(status = 'submitted') AS pending FROM attempts WHERE quiz_id = ?")
    .bind(c.quiz.id)
    .first<{ n: number; pending: number | null }>();
  const q = c.quiz;
  const e = extra.errors ?? {};
  const total = questions.reduce((s, x) => s + x.points, 0);
  const done = ctx.url.searchParams.get("done");
  return page(
    adminLayout(
      ctx.view,
      c.lesson.title,
      "content",
      html`${crumbs(c)}
${alertBox(done ? DONE[done] : null, "success")}
<header class="page-head page-head-row">
  <div><h1>${c.lesson.title}</h1><p class="muted">${questions.length} أسئلة · المجموع ${formatPoints(total)} نقطة${c.lesson.status === "draft" ? " · مسودة" : " · منشور"}</p></div>
  <div class="actions actions-tight">
    <a class="btn btn-secondary btn-sm" href="/lessons/${String(c.lesson.id)}">${icon("eye")}معاينة</a>
    <a class="btn btn-secondary btn-sm" href="/admin/quizzes/${String(q.id)}/results">${icon("check")}النتائج (${counts?.n ?? 0})${counts?.pending ? html` <span class="pill pill-warning">${counts.pending} للتصحيح</span>` : ""}</a>
  </div>
</header>
${(counts?.n ?? 0) > 0 ? alertBox("اجتاز تلاميذ هذا الاختبار. تعديل الأسئلة لا يغيّر علامات المحاولات السابقة.", "info") : ""}

<section class="section" aria-labelledby="qs-title">
  <h2 id="qs-title">الأسئلة</h2>
  ${
    questions.length
      ? html`<ol class="q-list">${questions.map(
          (x, i) => html`<li class="card q-card">
    <div class="q-head"><span class="unit-num">${i + 1}</span><span class="pill pill-muted">${QUESTION_TYPES[x.type]}</span><span class="pill pill-muted">${formatPoints(x.points)} ن</span></div>
    ${questionPreview(x)}
    <div class="lesson-actions q-actions">
      <span class="move-btns">
        ${i === 0 ? html`<span class="icon-btn icon-btn-off" aria-hidden="true">${icon("arrowUp", "icon icon-sm")}</span>` : html`<form method="post" action="/admin/questions/${String(x.id)}/move" class="inline-form"><input type="hidden" name="dir" value="up"><button class="icon-btn" type="submit" aria-label="تقديم">${icon("arrowUp", "icon icon-sm")}</button></form>`}
        ${i === questions.length - 1 ? html`<span class="icon-btn icon-btn-off" aria-hidden="true">${icon("arrowDown", "icon icon-sm")}</span>` : html`<form method="post" action="/admin/questions/${String(x.id)}/move" class="inline-form"><input type="hidden" name="dir" value="down"><button class="icon-btn" type="submit" aria-label="تأخير">${icon("arrowDown", "icon icon-sm")}</button></form>`}
      </span>
      <a class="btn btn-secondary btn-xs" href="/admin/questions/${String(x.id)}">${icon("pencil", "icon icon-sm")}تعديل</a>
      <details class="sub-del"><summary class="btn-link btn-danger-link" aria-label="حذف السؤال">${icon("trash", "icon icon-sm")}</summary>
        <form method="post" action="/admin/questions/${String(x.id)}/delete" class="form"><label class="check"><input type="checkbox" name="confirm" value="1" required> أؤكد حذف السؤال</label><button class="btn btn-danger btn-xs" type="submit">حذف</button></form>
      </details>
    </div>
  </li>`,
        )}</ol>`
      : html`<div class="card empty"><p>لا أسئلة بعد. اختر نوع السؤال الأول.</p></div>`
  }
  <div class="card form-card add-q">
    <h3>إضافة سؤال</h3>
    <div class="type-grid">${(Object.keys(QUESTION_TYPES) as QuestionType[]).map(
      (t) => html`<a class="btn btn-secondary btn-sm" href="/admin/quizzes/${String(q.id)}/new?type=${t}">${icon("plus", "icon icon-sm")}${QUESTION_TYPES[t]}</a>`,
    )}</div>
  </div>
</section>

<section class="card form-card section" aria-labelledby="set-title">
  <h2 id="set-title">الإعدادات</h2>
  ${alertBox(Object.keys(e).length ? "راجع الخانات المشار إليها." : null)}
  <form method="post" action="/admin/quizzes/${String(q.id)}/settings" class="form" novalidate>
    ${textarea({ name: "instructions", label: "تعليمات تظهر قبل البدء (اختياري)", value: q.instructions ?? "", rows: 3, maxlength: 2000 })}
    <div class="date-grid">
      ${input({ name: "time_limit", label: "المدة بالدقائق", value: q.time_limit ? String(q.time_limit) : "", inputmode: "numeric", dir: "ltr", error: e.time_limit, hint: "فارغ = بدون وقت محدد" })}
      ${input({ name: "max_attempts", label: "عدد المحاولات", value: q.max_attempts ? String(q.max_attempts) : "", inputmode: "numeric", dir: "ltr", error: e.max_attempts, hint: "فارغ = بدون حد" })}
    </div>
    ${select({ name: "results", label: "متى يرى التلميذ والولي النتيجة", options: (Object.keys(RESULTS_MODES) as ResultsMode[]).map((m) => ({ value: m, label: RESULTS_MODES[m] })), value: q.results })}
    <label class="check"><input type="checkbox" name="shuffle_questions" value="1"${q.shuffle_questions ? html` checked` : ""}> خلط ترتيب الأسئلة لكل تلميذ</label>
    <label class="check"><input type="checkbox" name="shuffle_choices" value="1"${q.shuffle_choices ? html` checked` : ""}> خلط ترتيب الاختيارات</label>
    <label class="check"><input type="checkbox" name="allow_upload" value="1"${q.allow_upload ? html` checked` : ""}> يرفع التلميذ حله في ملف PDF (حتى 5 ميغابايت) لتصححه</label>
    <button class="btn btn-primary btn-sm" type="submit">حفظ الإعدادات</button>
  </form>
  <p class="muted small">العنوان، والمجاني أو المدفوع، والنشر: من <a href="/admin/lessons/${String(c.lesson.id)}">صفحة الدرس</a> كبقية الدروس.</p>
</section>`,
      EDITOR_SCRIPTS,
    ),
    status,
  );
}

async function saveSettings(ctx: Ctx, c: QuizContext): Promise<Response> {
  const form = await readForm(ctx.request);
  const errors: Record<string, string> = {};
  const num = (k: string, min: number, max: number): number | null => {
    const v = field(form, k);
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors[k] = `عدد صحيح بين ${min} و${max}.`;
      return null;
    }
    return n;
  };
  const timeLimit = num("time_limit", 1, 600);
  const maxAttempts = num("max_attempts", 1, 50);
  if (Object.keys(errors).length) return showEditor(ctx, c, { errors }, 400);
  const results = (Object.keys(RESULTS_MODES) as string[]).includes(field(form, "results")) ? field(form, "results") : "immediate";
  await ctx.env.DB
    .prepare(
      "UPDATE quizzes SET instructions = ?, time_limit = ?, max_attempts = ?, results = ?, shuffle_questions = ?, shuffle_choices = ?, allow_upload = ?, updated_at = ? WHERE id = ?",
    )
    .bind(
      (form.get("instructions") ?? "").trim().slice(0, 2000) || null,
      timeLimit,
      maxAttempts,
      results,
      form.get("shuffle_questions") === "1" ? 1 : 0,
      form.get("shuffle_choices") === "1" ? 1 : 0,
      form.get("allow_upload") === "1" ? 1 : 0,
      ctx.now,
      c.quiz.id,
    )
    .run();
  return redirect(`/admin/quizzes/${c.quiz.id}?done=settings`);
}

// ---------- محرر السؤال ----------

const MATH_HELP = html`<p class="field-hint">اكتب الرياضيات بين علامتي $ أو استعمل الأزرار، مثل: $\\frac{3}{4}$ أو $\\sqrt{2}$. المعاينة تظهر تحت الخانة.</p>`;

function questionForm(
  ctx: Ctx,
  c: QuizContext,
  type: QuestionType,
  values: Record<string, string>,
  errors: Record<string, string>,
  action: string,
  title: string,
): string {
  const v = values;
  const e = errors;
  let fields: Raw | string = "";
  if (type === "single" || type === "multiple") {
    fields = html`<fieldset class="choices-field${e.choices ? " field-invalid" : ""}">
  <legend>الاختيارات ${type === "single" ? "(حدّد الإجابة الصحيحة)" : "(حدّد كل الإجابات الصحيحة)"}</legend>
  ${Array.from({ length: MAX_CHOICES }, (_, k) => {
    const i = k + 1;
    const marked = type === "single" ? v.correct === String(i) : v[`correct_${i}`] === "1";
    return html`<div class="choice-row">
      <label class="choice-mark">${
        type === "single"
          ? html`<input type="radio" name="correct" value="${String(i)}"${marked ? html` checked` : ""} aria-label="الاختيار ${String(i)} هو الصحيح">`
          : html`<input type="checkbox" name="correct_${String(i)}" value="1"${marked ? html` checked` : ""} aria-label="الاختيار ${String(i)} صحيح">`
      }</label>
      <input class="input" dir="auto" name="choice_${String(i)}" id="f-choice_${String(i)}" value="${v[`choice_${i}`] ?? ""}" placeholder="الاختيار ${String(i)}${i > 2 ? " (اختياري)" : ""}" maxlength="500" data-math-input aria-label="الاختيار ${String(i)}">
      <div class="math-preview" data-math-preview="choice_${String(i)}" aria-hidden="true"></div>
    </div>`;
  })}
  ${e.choices ? html`<p class="field-error">${e.choices}</p>` : ""}
</fieldset>`;
  } else if (type === "truefalse") {
    fields = html`<fieldset class="${e.answer ? "field-invalid" : ""}"><legend>الإجابة الصحيحة</legend>
  <div class="tf-row">
    <label class="check"><input type="radio" name="answer" value="true"${v.answer === "true" ? html` checked` : ""}> صح</label>
    <label class="check"><input type="radio" name="answer" value="false"${v.answer === "false" ? html` checked` : ""}> خطأ</label>
  </div>
  ${e.answer ? html`<p class="field-error">${e.answer}</p>` : ""}
</fieldset>`;
  } else if (type === "numeric") {
    fields = html`<div class="date-grid">
  ${input({ name: "value", label: "الإجابة الصحيحة", value: v.value, dir: "ltr", error: e.value, hint: "عدد، أو كسر مثل 3/4، أو √2. يقبل التلميذ أي كتابة مساوية: 0,75 = 3/4." })}
  ${input({ name: "tolerance", label: "هامش الخطأ المقبول (اختياري)", value: v.tolerance, dir: "ltr", inputmode: "text", error: e.tolerance, hint: "مثال: 0,01 لقبول 1,41 كقيمة لـ √2" })}
</div>`;
  } else if (type === "short") {
    fields = html`${select({ name: "mode", label: "نوع الإجابة", options: [{ value: "text", label: "نص (كلمة أو جملة قصيرة)" }, { value: "math", label: "عبارة رياضية (تُقبل كل كتابة مساوية)" }], value: v.mode ?? "text" })}
${textarea({ name: "accepted", label: "الإجابات المقبولة: واحدة في كل سطر", value: v.accepted, rows: 4, dir: "auto", error: e.accepted, hint: "اكتب كل الصيغ التي يمكن أن يكتبها التلميذ. النص: الحروف الكبيرة والحركات والهمزات لا تهم. العبارة: 2x+3 تقبل 3+2x و(4x+6)/2." })}
<label class="check"><input type="checkbox" name="ai" value="1"${v.ai !== "0" ? html` checked` : ""}> للإجابة النصية: إن لم تطابق إجابة التلميذ القائمة، يحكم عليها الذكاء الاصطناعي فورًا، وتظهر لك للمراجعة</label>`;
  } else {
    fields = html`<p class="muted">يكتب التلميذ إجابته نصًا، وتصححها أنت من صفحة النتائج.</p>`;
  }
  return adminLayout(
    ctx.view,
    title,
    "content",
    html`${crumbs(c, title)}
<header class="page-head"><h1>${title}</h1><p class="muted">${QUESTION_TYPES[type]}</p></header>
${alertBox(Object.keys(e).length ? "راجع الخانات المشار إليها." : null)}
<form method="post" action="${action}" class="card form-card form" novalidate>
  <input type="hidden" name="type" value="${type}">
  <div class="field${e.text ? " field-invalid" : ""}">
    <label for="f-text">نص السؤال</label>
    <div class="math-toolbar" role="toolbar" aria-label="أزرار الكتابة الرياضية" data-math-toolbar hidden>
      <button type="button" class="tool" data-insert="\\frac{□}{□}" title="كسر">a/b</button>
      <button type="button" class="tool" data-insert="\\sqrt{□}" title="جذر">√</button>
      <button type="button" class="tool" data-insert="^{□}" title="أس">xⁿ</button>
      <button type="button" class="tool" data-insert="_{□}" title="دليل">x₁</button>
      <button type="button" class="tool" data-insert="\\times " title="ضرب">×</button>
      <button type="button" class="tool" data-insert="\\div " title="قسمة">÷</button>
      <button type="button" class="tool" data-insert="\\leq " title="أصغر من أو يساوي">≤</button>
      <button type="button" class="tool" data-insert="\\geq " title="أكبر من أو يساوي">≥</button>
      <button type="button" class="tool" data-insert="\\neq " title="لا يساوي">≠</button>
      <button type="button" class="tool" data-insert="\\pi " title="بي">π</button>
      <button type="button" class="tool" data-insert="\\widehat{□}" title="زاوية">∠</button>
      <button type="button" class="tool" data-insert="\\overrightarrow{□}" title="شعاع">→</button>
      <button type="button" class="tool" data-insert="\\begin{cases} □ \\\\ □ \\end{cases}" title="جملة معادلتين">{</button>
    </div>
    <textarea id="f-text" class="input textarea" name="text" rows="4" maxlength="3000" data-math-input${e.text ? html` aria-invalid="true"` : ""} aria-describedby="f-text-help">${v.text ?? ""}</textarea>
    <div id="f-text-help">${MATH_HELP}</div>
    <div class="math-preview math-preview-block" data-math-preview="text" aria-live="polite"></div>
    ${e.text ? html`<p class="field-error">${e.text}</p>` : ""}
  </div>
  ${fields}
  ${input({ name: "points", label: "العلامة (نقاط)", value: v.points ?? "1", dir: "ltr", inputmode: "text", error: e.points })}
  <div class="actions">
    <button class="btn btn-primary btn-sm" type="submit">حفظ السؤال</button>
    <a class="btn btn-secondary btn-sm" href="/admin/quizzes/${String(c.quiz.id)}">إلغاء</a>
  </div>
</form>`,
    EDITOR_SCRIPTS,
  );
}

function valuesOf(q: Question): Record<string, string> {
  const d = questionData(q);
  const v: Record<string, string> = { text: q.text, points: formatPoints(q.points) };
  (d.choices ?? []).forEach((ch, k) => {
    v[`choice_${k + 1}`] = ch.text;
    if ((d.correct ?? []).includes(ch.id)) {
      v[`correct_${k + 1}`] = "1";
      v.correct = String(k + 1);
    }
  });
  if (q.type === "truefalse") v.answer = d.answer ? "true" : "false";
  if (q.type === "numeric") {
    v.value = d.value ?? "";
    v.tolerance = d.tolerance ? String(d.tolerance).replace(".", ",") : "";
  }
  if (q.type === "short") {
    v.mode = d.mode ?? "text";
    v.accepted = (d.accepted ?? []).join("\n");
    v.ai = d.ai === false ? "0" : "1";
  }
  return v;
}

function typeParam(ctx: Ctx): QuestionType | null {
  const t = ctx.url.searchParams.get("type") ?? "";
  return t in QUESTION_TYPES ? (t as QuestionType) : null;
}

function newQuestion(ctx: Ctx, c: QuizContext): Response {
  const type = typeParam(ctx);
  if (!type) return redirect(`/admin/quizzes/${c.quiz.id}`);
  return page(questionForm(ctx, c, type, {}, {}, `/admin/quizzes/${c.quiz.id}/new`, "سؤال جديد"));
}

function editQuestion(ctx: Ctx, c: QuizContext, q: Question): Response {
  return page(questionForm(ctx, c, q.type, valuesOf(q), {}, `/admin/questions/${q.id}`, "تعديل السؤال"));
}

async function saveQuestion(ctx: Ctx, c: QuizContext, existing: Question | null): Promise<Response> {
  const form = await readForm(ctx.request);
  const typeText = existing?.type ?? field(form, "type");
  if (!(typeText in QUESTION_TYPES)) return redirect(`/admin/quizzes/${c.quiz.id}`);
  const type = typeText as QuestionType;
  const { input: q, errors } = readQuestionForm(type, form);
  if (Object.keys(errors).length) {
    const values: Record<string, string> = {};
    for (const [k, val] of form) values[k] = val;
    if (!form.has("ai")) values.ai = "0";
    const action = existing ? `/admin/questions/${existing.id}` : `/admin/quizzes/${c.quiz.id}/new`;
    return page(questionForm(ctx, c, type, values, errors, action, existing ? "تعديل السؤال" : "سؤال جديد"), 400);
  }
  const db = ctx.env.DB;
  if (existing) {
    await db
      .prepare("UPDATE questions SET text = ?, points = ?, data = ?, updated_at = ? WHERE id = ?")
      .bind(q.text, q.points, JSON.stringify(q.data), ctx.now, existing.id)
      .run();
    return redirect(`/admin/quizzes/${c.quiz.id}?done=q-saved#qs-title`);
  }
  const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM questions WHERE quiz_id = ?").bind(c.quiz.id).first<{ n: number }>();
  await db
    .prepare("INSERT INTO questions (quiz_id, position, type, text, points, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(c.quiz.id, pos?.n ?? 1, type, q.text, q.points, JSON.stringify(q.data), ctx.now, ctx.now)
    .run();
  return redirect(`/admin/quizzes/${c.quiz.id}?done=q-added#qs-title`);
}

async function moveQuestion(ctx: Ctx, q: Question): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const rows = (await db.prepare("SELECT id FROM questions WHERE quiz_id = ? ORDER BY position, id").bind(q.quiz_id).all<{ id: number }>()).results;
  const i = rows.findIndex((r) => r.id === q.id);
  const j = field(form, "dir") === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < rows.length) {
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    await db.batch(rows.map((r, k) => db.prepare("UPDATE questions SET position = ? WHERE id = ?").bind(k + 1, r.id)));
  }
  return redirect(`/admin/quizzes/${q.quiz_id}#qs-title`);
}

async function deleteQuestion(ctx: Ctx, q: Question): Promise<Response> {
  const form = await readForm(ctx.request);
  if (form.get("confirm") !== "1") return redirect(`/admin/quizzes/${q.quiz_id}`);
  await ctx.env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(q.id).run();
  return redirect(`/admin/quizzes/${q.quiz_id}?done=q-deleted#qs-title`);
}

// ---------- النتائج والتصحيح ----------

interface ResultRow extends Attempt {
  student: string;
  parent: string;
  account_id: number;
  level: string;
}

const STATUS_LABELS: Record<Attempt["status"], string> = {
  in_progress: "جارية",
  submitted: "بانتظار التصحيح",
  graded: "مصحَّحة",
};

function statusPill(a: Attempt): Raw {
  const cls = a.status === "graded" ? "pill-success" : a.status === "submitted" ? "pill-warning" : "pill-muted";
  return html`<span class="pill ${cls}">${STATUS_LABELS[a.status]}</span>`;
}

async function showResults(ctx: Ctx, c: QuizContext): Promise<Response> {
  const db = ctx.env.DB;
  const rows = (
    await db
      .prepare(
        `SELECT t.*, s.name AS student, s.level, a.name AS parent, a.id AS account_id FROM attempts t
         JOIN students s ON s.id = t.student_id JOIN accounts a ON a.id = s.account_id
         WHERE t.quiz_id = ? ORDER BY t.started_at DESC LIMIT 500`,
      )
      .bind(c.quiz.id)
      .all<ResultRow>()
  ).results;
  // المحاولات التي انتهى وقتها تُغلق قبل العرض
  for (const r of rows) {
    if (r.status === "in_progress") Object.assign(r, await closeIfExpired(db, c.quiz, r, ctx.now, aiGrader(ctx.env)));
  }
  const done = ctx.url.searchParams.get("done");
  const graded = rows.filter((r) => r.status !== "in_progress");
  const avg = graded.length ? graded.reduce((s, r) => s + Number(on20(r.score, r.max_score).replace(",", ".")) || 0, 0) / graded.length : null;
  return page(
    adminLayout(
      ctx.view,
      `نتائج ${c.lesson.title}`,
      "content",
      html`${crumbs(c, "النتائج")}
${alertBox(done ? DONE[done] : null, "success")}
<header class="page-head page-head-row">
  <div><h1>نتائج: ${c.lesson.title}</h1><p class="muted">${rows.length} محاولة${avg !== null ? html` · المعدل ${String(Math.round(avg * 4) / 4).replace(".", ",")} / 20` : ""}</p></div>
  ${
    c.quiz.results === "released"
      ? html`<form method="post" action="/admin/quizzes/${String(c.quiz.id)}/release" class="inline-form"><button class="btn ${c.quiz.results_released ? "btn-secondary" : "btn-primary"} btn-sm" type="submit">${c.quiz.results_released ? html`${icon("eyeOff")}إخفاء النتائج` : html`${icon("eye")}نشر النتائج للتلاميذ`}</button></form>`
      : ""
  }
</header>
${
  rows.length
    ? html`<ol class="card admin-list">${rows.map(
        (r) => html`<li>
      <a class="admin-list-main" href="/admin/attempts/${String(r.id)}"><strong>${r.student}</strong><small>${r.parent} · ${when(r.started_at)}${r.upload_key ? " · ملف مرفوع" : ""}</small></a>
      ${r.ai_review ? html`<span class="pill pill-ai">${icon("sparkle", "icon icon-sm")}للمراجعة</span>` : ""}${statusPill(r)}
      <span class="score-chip">${r.status === "in_progress" ? "…" : html`<bdi dir="ltr">${on20(r.score, r.max_score)}/20</bdi>`}</span>
    </li>`,
      )}</ol>`
    : html`<div class="card empty"><p>لم يجتز أحد هذا الاختبار بعد.</p></div>`
}`,
    ),
  );
}

async function toggleRelease(ctx: Ctx, c: QuizContext): Promise<Response> {
  const next = c.quiz.results_released ? 0 : 1;
  await ctx.env.DB.prepare("UPDATE quizzes SET results_released = ?, updated_at = ? WHERE id = ?").bind(next, ctx.now, c.quiz.id).run();
  await audit(ctx.env.DB, adminId(ctx), next ? "quiz.released" : "quiz.hidden", `quiz:${c.quiz.id}`, c.lesson.title);
  return redirect(`/admin/quizzes/${c.quiz.id}/results?done=${next ? "released" : "hidden"}`);
}

async function showAttempt(ctx: Ctx, c: QuizContext, attemptIn: Attempt, errors: Record<string, string> = {}, status = 200): Promise<Response> {
  const db = ctx.env.DB;
  const attempt = await closeIfExpired(db, c.quiz, attemptIn, ctx.now, aiGrader(ctx.env));
  const student = await db
    .prepare("SELECT s.name, a.name AS parent, a.id AS account_id FROM students s JOIN accounts a ON a.id = s.account_id WHERE s.id = ?")
    .bind(attempt.student_id)
    .first<{ name: string; parent: string; account_id: number }>();
  const questions = orderedQuestions(await loadQuestions(db, c.quiz.id), readLayout(attempt));
  const answers = new Map((await loadAnswers(db, attempt.id)).map((a) => [a.question_id, a]));
  const done = ctx.url.searchParams.get("done");
  const open = attempt.status === "in_progress";
  return page(
    adminLayout(
      ctx.view,
      `محاولة ${student?.name ?? ""}`,
      "content",
      html`${crumbs(c, student?.name ?? "محاولة")}
${alertBox(done ? DONE[done] : null, "success")}
${alertBox(Object.keys(errors).length ? "راجع العلامات المشار إليها." : null)}
<header class="page-head page-head-row">
  <div><h1>${student?.name ?? ""}</h1><p class="muted"><a href="/admin/families/${String(student?.account_id ?? 0)}">${student?.parent ?? ""}</a> · بدأ ${when(attempt.started_at)}${attempt.submitted_at ? html` · سلّم ${when(attempt.submitted_at)}` : ""}</p></div>
  <p>${statusPill(attempt)} <span class="score-chip">${open ? "…" : html`<bdi dir="ltr">${on20(attempt.score, attempt.max_score)}/20</bdi>`}</span>${open ? "" : html` <span class="muted small"><bdi dir="ltr">${formatPoints(attempt.score)} / ${formatPoints(attempt.max_score)}</bdi> نقطة</span>`}</p>
</header>
${open ? alertBox("المحاولة ما زالت جارية. التصحيح يكون بعد التسليم.", "info") : ""}
${
  attempt.upload_key
    ? html`<p><a class="btn btn-secondary btn-sm" href="/attempts/${String(attempt.id)}/upload" target="_blank" rel="noopener">${icon("pdf")}فتح ملف الحل${attempt.upload_name ? html` (<bdi>${attempt.upload_name}</bdi>)` : ""}</a></p>`
    : c.quiz.allow_upload && !open
      ? html`<p class="muted">لم يرفع التلميذ ملف حل.</p>`
      : ""
}
<form method="post" action="/admin/attempts/${String(attempt.id)}" class="form" novalidate>
  <ol class="q-list">${questions.map((q, i) => {
    const a = answers.get(q.id);
    return html`<li class="card q-card">
      <div class="q-head"><span class="unit-num">${i + 1}</span><span class="pill pill-muted">${QUESTION_TYPES[q.type]}</span></div>
      ${questionPreview(q)}
      <div class="q-given"><span class="muted">إجابة التلميذ:</span> ${answerView(q, a?.value ?? "")}</div>
      ${aiNote(q, a, attempt)}
      ${gradeField(q, a, errors, open)}
    </li>`;
  })}</ol>
  ${
    open
      ? ""
      : html`<section class="card form-card">
    ${textarea({ name: "feedback", label: "ملاحظة عامة للتلميذ (اختياري)", value: attempt.feedback ?? "", rows: 3, maxlength: 1000 })}
    <button class="btn btn-primary" type="submit">حفظ التصحيح</button>
  </section>`
  }
</form>`,
      ["/katex/katex.min.js"],
    ),
    status,
  );
}

/** حكم الذكاء الاصطناعي على إجابة، مع زر لإضافتها إلى الإجابات المقبولة. */
function aiNote(q: Question, a: Answer | undefined, attempt: Attempt): Raw {
  if (!a?.ai_verdict) {
    // تعذّر الحكم: الإجابة تنتظر علامتك
    if (usesAi(q) && attempt.status !== "in_progress" && a?.value.trim() && a.auto_score === null && a.manual_score === null) {
      return html`<p class="ai-note ai-note-pending">${icon("sparkle", "icon icon-sm")}لم يتمكن الذكاء الاصطناعي من الحكم على هذه الإجابة. ضع علامتها بنفسك.</p>`;
    }
    return html``;
  }
  const ok = a.ai_verdict === "correct";
  return html`<div class="ai-note ${ok ? "ai-note-ok" : "ai-note-no"}">
    <p>${icon("sparkle", "icon icon-sm")}<strong>حكم الذكاء الاصطناعي: ${ok ? "صحيحة" : "خاطئة"}</strong>${a.ai_reason ? html` · ${a.ai_reason}` : ""}</p>
    ${
      a.manual_score === null && attempt.status !== "in_progress"
        ? html`<button class="btn btn-secondary btn-xs" type="submit" formaction="/admin/attempts/${String(attempt.id)}/accept/${String(q.id)}" formnovalidate>${icon("check")}أضفها إلى الإجابات المقبولة</button>`
        : ""
    }
  </div>`;
}

function gradeField(q: Question, a: Answer | undefined, errors: Record<string, string>, open: boolean): Raw {
  if (open) return html``;
  const auto = a?.auto_score ?? null;
  const current = a?.manual_score ?? auto;
  const label = q.type === "open" ? "العلامة" : "العلامة (آليًا، يمكنك تعديلها)";
  return html`<div class="grade-row">
    ${input({ name: `score_${q.id}`, id: `f-score-${q.id}`, label: `${label} من ${formatPoints(q.points)}`, value: current === null ? "" : formatPoints(current), dir: "ltr", inputmode: "text", error: errors[`score_${q.id}`] })}
    ${input({ name: `note_${q.id}`, id: `f-note-${q.id}`, label: "ملاحظة على هذا السؤال (اختياري)", value: a?.feedback ?? "", maxlength: 500 })}
  </div>`;
}

async function saveGrades(ctx: Ctx, c: QuizContext, attemptIn: Attempt): Promise<Response> {
  const db = ctx.env.DB;
  const attempt = await closeIfExpired(db, c.quiz, attemptIn, ctx.now, aiGrader(ctx.env));
  if (attempt.status === "in_progress") return showAttempt(ctx, c, attempt, {}, 409);
  const form = await readForm(ctx.request);
  const questions = orderedQuestions(await loadQuestions(db, c.quiz.id), readLayout(attempt));
  const answers = new Map((await loadAnswers(db, attempt.id)).map((a) => [a.question_id, a]));
  const errors: Record<string, string> = {};
  const updates = [];
  for (const q of questions) {
    const raw = field(form, `score_${q.id}`).replace(",", ".");
    const note = field(form, `note_${q.id}`).slice(0, 500) || null;
    const a = answers.get(q.id);
    let manual: number | null = null;
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > q.points) {
        errors[`score_${q.id}`] = `بين 0 و${formatPoints(q.points)}.`;
        continue;
      }
      // علامة الأستاذ تُحفظ فقط إن كانت مختلفة عن الآلية
      manual = a?.auto_score !== null && a?.auto_score !== undefined && Math.abs(a.auto_score - n) < 1e-9 ? null : n;
    } else if (q.type === "open") {
      errors[`score_${q.id}`] = "ضع علامة لهذا السؤال.";
      continue;
    }
    updates.push(
      db
        .prepare(
          `INSERT INTO answers (attempt_id, question_id, value, manual_score, feedback, updated_at) VALUES (?, ?, '', ?, ?, ?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET manual_score = excluded.manual_score, feedback = excluded.feedback`,
        )
        .bind(attempt.id, q.id, manual, note, ctx.now),
    );
  }
  if (Object.keys(errors).length) return showAttempt(ctx, c, attempt, errors, 400);
  updates.push(
    db
      .prepare("UPDATE attempts SET status = 'graded', graded_at = ?, feedback = ?, ai_review = 0 WHERE id = ?")
      .bind(ctx.now, field(form, "feedback").slice(0, 1000) || null, attempt.id),
  );
  await db.batch(updates);
  await recomputeScore(db, attempt.id);
  await audit(db, adminId(ctx), "attempt.graded", `quiz:${c.quiz.id}`, c.lesson.title);
  return redirect(`/admin/attempts/${attempt.id}?done=graded`);
}

/**
 * «أضفها إلى الإجابات المقبولة»: إجابة التلميذ تصبح مقبولة في السؤال، وتُصحَّح بها كل المحاولات
 * التي كتبت نفس الإجابة (ما لم يضع الأستاذ علامة بيده). الإجابة تؤخذ من قاعدة البيانات، لا من النموذج.
 */
async function acceptAnswer(ctx: Ctx, c: QuizContext, attempt: Attempt, questionId: number): Promise<Response> {
  const db = ctx.env.DB;
  const [qRes, aRes] = await db.batch([
    db.prepare("SELECT * FROM questions WHERE id = ? AND quiz_id = ?").bind(questionId, c.quiz.id),
    db.prepare("SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?").bind(attempt.id, questionId),
  ]);
  const q = qRes?.results[0] as unknown as Question | undefined;
  const a = aRes?.results[0] as unknown as Answer | undefined;
  const value = a?.value.trim().slice(0, 200) ?? "";
  if (!q || q.type !== "short" || !value) return page(notFoundPage(ctx.view), 404);
  const d = questionData(q);
  const accepted = d.accepted ?? [];
  if (!accepted.some((x) => normalizeText(x) === normalizeText(value))) {
    if (accepted.length >= 20) return redirect(`/admin/attempts/${attempt.id}?done=accept-full`);
    accepted.push(value);
  }
  const updatedQ = { ...q, data: JSON.stringify({ ...d, accepted }) };
  const others = (
    await db
      .prepare("SELECT n.attempt_id, n.value FROM answers n JOIN attempts t ON t.id = n.attempt_id WHERE n.question_id = ? AND t.status != 'in_progress' AND n.manual_score IS NULL")
      .bind(q.id)
      .all<{ attempt_id: number; value: string }>()
  ).results.filter((r) => isCorrect(updatedQ, r.value));
  const statements: D1PreparedStatement[] = [db.prepare("UPDATE questions SET data = ?, updated_at = ? WHERE id = ?").bind(updatedQ.data, ctx.now, q.id)];
  for (const r of others) statements.push(db.prepare("UPDATE answers SET auto_score = ? WHERE attempt_id = ? AND question_id = ?").bind(q.points, r.attempt_id, q.id));
  // إعادة حساب علامة كل محاولة تأثرت
  for (const id of new Set(others.map((r) => r.attempt_id))) {
    statements.push(
      db.prepare("UPDATE attempts SET score = (SELECT COALESCE(SUM(COALESCE(manual_score, auto_score, 0)), 0) FROM answers WHERE attempt_id = ?) WHERE id = ?").bind(id, id),
    );
  }
  await db.batch(statements);
  await audit(db, adminId(ctx), "question.answer_accepted", `quiz:${c.quiz.id}`, `${c.lesson.title}: ${value}`);
  return redirect(`/admin/attempts/${attempt.id}?done=accepted`);
}

/** للوحة التحكم: المحاولات التي تنتظر التصحيح، أو فيها أحكام للذكاء الاصطناعي لم تُراجع. */
export async function pendingGrading(ctx: Ctx) {
  const r = await ctx.env.DB
    .prepare(
      `SELECT t.id, t.submitted_at, t.status, t.ai_review, s.name AS student, l.title AS quiz FROM attempts t
       JOIN students s ON s.id = t.student_id JOIN lessons l ON l.quiz_id = t.quiz_id
       WHERE t.status = 'submitted' OR t.ai_review = 1 ORDER BY t.submitted_at LIMIT 50`,
    )
    .all<{ id: number; submitted_at: number; status: string; ai_review: number; student: string; quiz: string }>();
  return r.results;
}

export { questionPreview };
