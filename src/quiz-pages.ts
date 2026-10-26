// صفحات الاختبار للتلميذ والولي: التقديم قبل البدء، والاجتياز، والنتيجة.

import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, layout, type View } from "./ui.ts";
import { answerMath, mathText } from "./math.ts";
import type { LessonContext } from "./content.ts";
import { formatDate } from "./subscriptions.ts";
import {
  QUESTION_TYPES,
  choiceList,
  formatPoints,
  isCorrect,
  on20,
  questionData,
  visibility,
  type Answer,
  type Attempt,
  type Layout,
  type Question,
  type Quiz,
} from "./quiz.ts";

/** صفحات الاجتياز تحتاج KaTeX للمعاينة، وقارئ العبارات، وكود الحفظ والمؤقت. */
const TAKE_SCRIPTS = ["/katex/katex.min.js", "/quiz.js"];

function minutes(n: number): string {
  if (n === 1) return "دقيقة واحدة";
  if (n === 2) return "دقيقتان";
  if (n <= 10) return `${n} دقائق`;
  return `${n} دقيقة`;
}

/** إجابة التلميذ كما تُعرض للأستاذ أو في النتيجة. */
export function answerView(q: Question, value: string): Raw {
  if (!value.trim()) return html`<span class="muted">لم يُجب</span>`;
  const d = questionData(q);
  const choiceText = (id: string) => (d.choices ?? []).find((c) => c.id === id)?.text ?? id;
  switch (q.type) {
    case "single":
      return mathText(choiceText(value));
    case "multiple":
      return html`${choiceList(value).map((id, i) => html`${i ? "، " : ""}${mathText(choiceText(id))}`)}`;
    case "truefalse":
      return html`${value === "true" ? "صح" : "خطأ"}`;
    case "numeric":
      return answerMath(value);
    case "short":
      return d.mode === "math" ? answerMath(value) : html`<bdi>${value}</bdi>`;
    default:
      return html`<span class="open-answer">${value}</span>`;
  }
}

/** الإجابة الصحيحة كما تُعرض في النتيجة. */
function correctView(q: Question): Raw | string {
  const d = questionData(q);
  switch (q.type) {
    case "single":
    case "multiple":
      return html`${(d.choices ?? []).filter((c) => (d.correct ?? []).includes(c.id)).map((c, i) => html`${i ? "، " : ""}${mathText(c.text)}`)}`;
    case "truefalse":
      return d.answer ? "صح" : "خطأ";
    case "numeric":
      return answerMath(d.value ?? "");
    case "short":
      return d.mode === "math" ? answerMath(d.accepted?.[0] ?? "") : html`<bdi>${d.accepted?.[0] ?? ""}</bdi>`;
    default:
      return "";
  }
}

// ---------- صفحة التقديم ----------

export interface AttemptSummary {
  attempt: Attempt;
  student?: string;
}

export function quizIntroPage(
  view: View,
  c: LessonContext,
  quiz: Quiz,
  o: {
    questions: number;
    points: number;
    /** التلميذ الحالي (ملف ابن) */
    asStudent: boolean;
    attempts: AttemptSummary[];
    inProgress: Attempt | null;
    canStart: boolean;
    message?: string | null;
  },
): string {
  const { program, unit, lesson } = c;
  const used = o.attempts.filter((x) => x.attempt.status !== "in_progress").length;
  const draft = lesson.status === "draft" || unit.status === "draft";
  return layout({
    title: lesson.title,
    view,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a><span aria-hidden="true">/</span><a href="/levels/${program.slug}">${program.title}</a><span aria-hidden="true">/</span><span aria-current="page">${unit.title}</span></nav>
${draft ? html`<div class="notice">${icon("info")}<span>معاينة: هذا الاختبار مسودة، لا يراه أحد غيرك.</span></div>` : ""}
<section class="card hero hero-compact">
  <span class="icon-box icon-box-lg">${icon("quiz")}</span>
  <h1>${lesson.title}</h1>
  <ul class="quiz-facts">
    <li>${icon("layers", "icon icon-sm")}${o.questions} أسئلة · ${formatPoints(o.points)} نقطة</li>
    <li>${icon("calendar", "icon icon-sm")}${quiz.time_limit ? `المدة: ${minutes(quiz.time_limit)}` : "بدون وقت محدد"}</li>
    <li>${icon("refresh", "icon icon-sm")}${quiz.max_attempts ? `المحاولات: ${used} من ${quiz.max_attempts}` : "محاولات غير محدودة"}</li>
  </ul>
  ${quiz.instructions ? html`<div class="quiz-instructions">${mathText(quiz.instructions)}</div>` : ""}
  ${alertBox(o.message ?? null, "info")}
  ${
    o.asStudent
      ? o.inProgress
        ? html`<div class="actions"><a class="btn btn-primary" href="/attempts/${String(o.inProgress.id)}">متابعة المحاولة ${icon("arrowLeft")}</a></div>`
        : o.canStart
          ? html`<form method="post" action="/quizzes/${String(quiz.id)}/start" class="actions">
    <button class="btn btn-primary" type="submit">${used ? "محاولة جديدة" : "ابدأ الاختبار"} ${icon("arrowLeft")}</button>
  </form>
  ${quiz.time_limit ? html`<p class="muted small">يبدأ الوقت عند الضغط، ولا يتوقف إذا أغلقت الصفحة. إجاباتك تُحفظ أولًا بأول.</p>` : ""}`
          : ""
      : ""
  }
</section>
${
  o.attempts.length
    ? html`<section class="section" aria-labelledby="att-title">
  <h2 id="att-title">${o.asStudent ? "محاولاتك" : "المحاولات"}</h2>
  <ol class="card admin-list">${o.attempts.map(({ attempt, student }) => {
    const vis = visibility(quiz, attempt);
    const pending = attempt.status === "submitted";
    return html`<li>
      <a class="admin-list-main" href="/attempts/${String(attempt.id)}"><strong>${student ? html`${student} · ` : ""}${formatDate(attempt.started_at)}</strong><small>${attempt.status === "in_progress" ? "جارية" : vis.score ? (pending ? "جزء من الأسئلة بانتظار تصحيح الأستاذ" : "مصحَّحة") : "النتيجة تظهر عندما ينشرها الأستاذ"}</small></a>
      ${vis.score ? html`<span class="score-chip"><bdi dir="ltr">${on20(attempt.score, attempt.max_score)}/20</bdi></span>` : ""}
    </li>`;
  })}</ol>
</section>`
    : ""
}
<p><a class="btn btn-secondary" href="/levels/${program.slug}#unit-${String(unit.id)}">العودة إلى ${program.title}</a></p>`,
  });
}

// ---------- صفحة الاجتياز ----------

function exprInput(name: string, value: string, label: string): Raw {
  return html`<div class="expr-field">
    <input class="input expr-input" id="${name}" name="${name}" value="${value}" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200" data-expr aria-label="${label}">
    <div class="keypad" data-keypad hidden>
      ${["/", "√(", "^", "(", ")", "x", "π", "−"].map((k) => html`<button type="button" class="key" data-key="${k === "−" ? "-" : k}" aria-label="${k}">${k === "/" ? "a/b" : k === "^" ? "xⁿ" : k === "√(" ? "√" : k}</button>`)}
      <button type="button" class="key key-del" data-key="⌫" aria-label="حذف">⌫</button>
    </div>
    <div class="math-preview" dir="ltr" data-expr-preview aria-live="polite"></div>
  </div>`;
}

function questionInput(q: Question, layoutOrder: string[] | undefined, value: string): Raw {
  const d = questionData(q);
  const name = `q_${q.id}`;
  const choices = (layoutOrder ?? (d.choices ?? []).map((c) => c.id))
    .map((id) => (d.choices ?? []).find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  switch (q.type) {
    case "single":
      return html`<div class="options">${choices.map(
        (c) => html`<label class="option"><input type="radio" name="${name}" value="${c.id}"${value === c.id ? html` checked` : ""}><span>${mathText(c.text)}</span></label>`,
      )}</div>`;
    case "multiple": {
      const picked = choiceList(value);
      return html`<p class="muted small">قد تكون أكثر من إجابة صحيحة.</p><div class="options">${choices.map(
        (c) => html`<label class="option"><input type="checkbox" name="${name}" value="${c.id}"${picked.includes(c.id) ? html` checked` : ""}><span>${mathText(c.text)}</span></label>`,
      )}</div>`;
    }
    case "truefalse":
      return html`<div class="options options-row">
        <label class="option"><input type="radio" name="${name}" value="true"${value === "true" ? html` checked` : ""}><span>صح</span></label>
        <label class="option"><input type="radio" name="${name}" value="false"${value === "false" ? html` checked` : ""}><span>خطأ</span></label>
      </div>`;
    case "numeric":
      return exprInput(name, value, "إجابتك (عدد)");
    case "short":
      return d.mode === "math"
        ? exprInput(name, value, "إجابتك (عبارة)")
        : html`<input class="input" name="${name}" value="${value}" maxlength="200" autocomplete="off" aria-label="إجابتك">`;
    default:
      return html`<textarea class="input textarea" name="${name}" rows="5" maxlength="2000" aria-label="إجابتك">${value}</textarea>`;
  }
}

export function attemptPage(
  view: View,
  c: LessonContext,
  quiz: Quiz,
  attempt: Attempt,
  questions: Question[],
  layoutData: Layout,
  answers: Map<number, Answer>,
  o: { now: number; uploads: boolean; error?: string },
): string {
  const id = String(attempt.id);
  const allowUpload = Boolean(quiz.allow_upload);
  return layout({
    title: c.lesson.title,
    view,
    current: "levels",
    scripts: TAKE_SCRIPTS,
    body: html`<header class="quiz-bar" data-quiz-bar>
  <strong>${c.lesson.title}</strong>
  ${attempt.deadline_at ? html`<span class="timer" data-deadline="${String(attempt.deadline_at)}" data-now="${String(o.now)}" role="timer" aria-live="off">${icon("calendar", "icon icon-sm")}<span data-timer-text>${minutes(Math.max(1, Math.ceil((attempt.deadline_at - o.now) / 60000)))}</span></span>` : ""}
  <span class="save-state" data-save-state aria-live="polite"></span>
</header>
${alertBox(o.error ?? null)}
<form method="post" action="/attempts/${id}/submit" class="quiz-form" data-attempt="${id}"${allowUpload ? html` enctype="multipart/form-data"` : ""} novalidate>
  <ol class="q-list">${questions.map(
    (q, i) => html`<li class="card q-card" data-qid="${String(q.id)}" data-qtype="${q.type}">
      <fieldset>
        <legend class="q-head"><span class="unit-num">${i + 1}</span><span class="pill pill-muted">${formatPoints(q.points)} ن</span><span class="sr-only">${QUESTION_TYPES[q.type]}</span></legend>
        <div class="q-text">${mathText(q.text)}</div>
        ${questionInput(q, layoutData.c[String(q.id)], answers.get(q.id)?.value ?? "")}
      </fieldset>
    </li>`,
  )}</ol>
  ${
    allowUpload
      ? html`<section class="card form-card">
    <h2>${icon("upload")} ملف الحل</h2>
    ${
      o.uploads
        ? html`<div class="field"><label for="f-solution">ارفع حلك في ملف PDF (حتى 5 ميغابايت)</label><input id="f-solution" class="input input-file" type="file" name="solution" accept="application/pdf,.pdf"></div>
    ${attempt.upload_name ? html`<p class="muted small">رُفع من قبل: <bdi>${attempt.upload_name}</bdi>. ملف جديد يحل محله.</p>` : ""}`
        : html`<p class="muted">رفع الملفات غير متاح حاليًا. أرسل حلك للأستاذ بطريقة أخرى.</p>`
    }
  </section>`
      : ""
  }
  <div class="card form-card submit-card">
    <p class="muted small" data-unanswered></p>
    <button class="btn btn-primary btn-block" type="submit">${icon("check")}تسليم الإجابات</button>
    <p class="muted small">بعد التسليم لا يمكن تغيير الإجابات.</p>
  </div>
</form>`,
  });
}

// ---------- صفحة النتيجة ----------

export function resultPage(
  view: View,
  c: LessonContext,
  quiz: Quiz,
  attempt: Attempt,
  questions: Question[],
  answers: Map<number, Answer>,
  o: { student?: string; justSubmitted?: boolean },
): string {
  const vis = visibility(quiz, attempt);
  const pending = attempt.status === "submitted";
  return layout({
    title: `نتيجة ${c.lesson.title}`,
    view,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels/${c.program.slug}">${c.program.title}</a><span aria-hidden="true">/</span><a href="/lessons/${String(c.lesson.id)}">${c.lesson.title}</a><span aria-hidden="true">/</span><span aria-current="page">النتيجة</span></nav>
${o.justSubmitted ? alertBox("سُلّمت إجاباتك.", "success") : ""}
<section class="card hero hero-compact result-hero">
  <span class="badge-pill"><span class="dot"></span>${o.student ?? "النتيجة"}</span>
  <h1>${c.lesson.title}</h1>
  ${
    vis.score
      ? html`<p class="big-score" dir="ltr">${on20(attempt.score, attempt.max_score)}<small>/20</small></p>
  <p class="muted"><bdi dir="ltr">${formatPoints(attempt.score)} / ${formatPoints(attempt.max_score)}</bdi> نقطة${pending ? " · الأسئلة المفتوحة بانتظار تصحيح الأستاذ، والعلامة قد ترتفع" : ""}</p>`
      : html`<p class="muted">تظهر النتيجة عندما ينشرها الأستاذ.</p>`
  }
  <p class="muted small">سُلّم ${attempt.submitted_at ? formatDate(attempt.submitted_at) : ""}</p>
  ${attempt.feedback && vis.score ? html`<div class="notice">${icon("chat")}<span>${attempt.feedback}</span></div>` : ""}
</section>
${
  vis.details
    ? html`<ol class="q-list">${questions.map((q, i) => {
        const a = answers.get(q.id);
        const score = a?.manual_score ?? a?.auto_score ?? null;
        const auto = isCorrect(q, a?.value ?? "");
        const state = score === null ? "pending" : score >= q.points ? "right" : score > 0 ? "partial" : "wrong";
        return html`<li class="card q-card q-${state}">
      <div class="q-head"><span class="unit-num">${i + 1}</span>
        <span class="pill ${state === "right" ? "pill-success" : state === "wrong" ? "pill-danger" : "pill-warning"}">${state === "right" ? "صحيح" : state === "wrong" ? "خطأ" : state === "partial" ? "جزئي" : "بانتظار التصحيح"}</span>
        <span class="score-chip"><bdi dir="ltr">${formatPoints(score)} / ${formatPoints(q.points)}</bdi></span></div>
      <div class="q-text">${mathText(q.text)}</div>
      <p class="q-given"><span class="muted">إجابتك:</span> ${answerView(q, a?.value ?? "")}</p>
      ${auto === false && q.type !== "open" ? html`<p class="q-key"><span class="muted">الإجابة الصحيحة:</span> ${correctView(q)}</p>` : ""}
      ${a?.feedback ? html`<p class="q-note">${icon("chat", "icon icon-sm")}${a.feedback}</p>` : ""}
    </li>`;
      })}</ol>`
    : ""
}
<p><a class="btn btn-secondary" href="/lessons/${String(c.lesson.id)}">العودة إلى الاختبار</a></p>`,
  });
}
