// الاختبارات: أنواع الأسئلة، والتحقق مما يكتبه الأستاذ، والتصحيح الآلي، ودورة المحاولة.
//
// قواعد معتمدة:
// - الوقت يُحسب في الخادم: deadline_at = وقت البدء + المدة. بعد انتهائه (مع 20 ثانية لتأخر الشبكة)
//   لا يُقبل أي حفظ، وتُغلق المحاولة بما حُفظ وتُصحَّح.
// - الاختيار المتعدد صحيح فقط إذا اختار التلميذ كل الاختيارات الصحيحة ولا شيء غيرها.
// - الأسئلة المفتوحة وملف الحل ينتظران تصحيح الأستاذ.

import type { D1Database, D1PreparedStatement, R2Bucket } from "./db.ts";
import { equivalent, numericValue, parse } from "../public/mathexpr.js";
import { MAX_AI_PER_ATTEMPT, judgeShortAnswer, type AiGrader, type AiJudgement } from "./ai-grade.ts";

export type QuestionType = "single" | "multiple" | "truefalse" | "numeric" | "short" | "open";
export type ResultsMode = "immediate" | "score" | "released";

export const QUESTION_TYPES: Record<QuestionType, string> = {
  single: "اختيار واحد",
  multiple: "اختيار متعدد",
  truefalse: "صح أو خطأ",
  numeric: "إجابة رقمية",
  short: "إجابة قصيرة",
  open: "سؤال مفتوح",
};

export const RESULTS_MODES: Record<ResultsMode, string> = {
  immediate: "فور التسليم: العلامة والإجابات الصحيحة",
  score: "فور التسليم: العلامة فقط",
  released: "عندما أنشر النتائج",
};

/** مهلة لتأخر الشبكة بعد انتهاء الوقت. */
export const GRACE_MS = 20_000;
export const MAX_CHOICES = 6;
/** أكبر ملف حل يرفعه التلميذ: 5 ميغابايت. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface Quiz {
  id: number;
  instructions: string | null;
  time_limit: number | null;
  max_attempts: number | null;
  shuffle_questions: number;
  shuffle_choices: number;
  results: ResultsMode;
  results_released: number;
  allow_upload: number;
  created_at: number;
  updated_at: number;
}

export interface Choice {
  id: string;
  text: string;
}

export interface QuestionData {
  choices?: Choice[];
  /** معرّفات الاختيارات الصحيحة */
  correct?: string[];
  /** صح أو خطأ */
  answer?: boolean;
  /** الإجابة الرقمية كعبارة (مثل 3/4) */
  value?: string;
  tolerance?: number;
  /** الإجابة القصيرة: نص أو عبارة رياضية */
  mode?: "text" | "math";
  accepted?: string[];
  /** الإجابة النصية: هل يُسأل الذكاء الاصطناعي عن الإجابات غير الموجودة في القائمة (مفعّل ما لم يُطفأ) */
  ai?: boolean;
}

export interface Question {
  id: number;
  quiz_id: number;
  position: number;
  type: QuestionType;
  text: string;
  points: number;
  data: string;
  created_at: number;
  updated_at: number;
}

export interface Attempt {
  id: number;
  quiz_id: number;
  student_id: number;
  started_at: number;
  deadline_at: number | null;
  submitted_at: number | null;
  status: "in_progress" | "submitted" | "graded";
  score: number | null;
  max_score: number | null;
  layout: string;
  upload_key: string | null;
  upload_name: string | null;
  upload_size: number | null;
  feedback: string | null;
  graded_at: number | null;
  /** 1 = فيها أحكام للذكاء الاصطناعي لم يراجعها الأستاذ */
  ai_review?: number;
}

export interface Answer {
  attempt_id: number;
  question_id: number;
  value: string;
  auto_score: number | null;
  manual_score: number | null;
  feedback: string | null;
  updated_at: number;
  ai_verdict?: "correct" | "wrong" | null;
  ai_reason?: string | null;
}

export function questionData(q: Pick<Question, "data">): QuestionData {
  try {
    const d = JSON.parse(q.data) as QuestionData;
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

// ---------- ما يكتبه الأستاذ ----------

export interface QuestionInput {
  type: QuestionType;
  text: string;
  points: number;
  data: QuestionData;
}

/** يقرأ نموذج السؤال ويتحقق منه. errors: رسالة لكل خانة خاطئة. */
export function readQuestionForm(type: QuestionType, form: Map<string, string>): { input: QuestionInput; errors: Record<string, string> } {
  const get = (k: string) => (form.get(k) ?? "").trim();
  const errors: Record<string, string> = {};
  const text = get("text").slice(0, 3000);
  if (text.length < 2) errors.text = "اكتب نص السؤال.";
  const points = Number(get("points").replace(",", ".") || "1");
  if (!Number.isFinite(points) || points <= 0 || points > 100) errors.points = "العلامة عدد بين 0,25 و100.";
  const data: QuestionData = {};

  if (type === "single" || type === "multiple") {
    const choices: Choice[] = [];
    const correct: string[] = [];
    for (let i = 1; i <= MAX_CHOICES; i++) {
      const t = get(`choice_${i}`).slice(0, 500);
      if (!t) continue;
      const id = String.fromCharCode(96 + i); // a, b, c...
      choices.push({ id, text: t });
      const marked = type === "single" ? get("correct") === String(i) : form.get(`correct_${i}`) === "1";
      if (marked) correct.push(id);
    }
    if (choices.length < 2) errors.choices = "اكتب اختيارين على الأقل.";
    else if (!correct.length) errors.choices = "حدّد الإجابة الصحيحة.";
    data.choices = choices;
    data.correct = correct;
  } else if (type === "truefalse") {
    const a = get("answer");
    if (a !== "true" && a !== "false") errors.answer = "حدّد: صح أم خطأ.";
    data.answer = a === "true";
  } else if (type === "numeric") {
    const value = get("value").slice(0, 100);
    if (numericValue(value) === null) errors.value = "اكتب عددًا، مثل 12 أو 3/4 أو 0,75 أو √2.";
    const tol = Number(get("tolerance").replace(",", ".") || "0");
    if (!Number.isFinite(tol) || tol < 0) errors.tolerance = "هامش الخطأ عدد موجب أو صفر.";
    data.value = value;
    data.tolerance = Number.isFinite(tol) && tol > 0 ? tol : 0;
  } else if (type === "short") {
    const mode = get("mode") === "math" ? "math" : "text";
    const accepted = (form.get("accepted") ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 20);
    if (!accepted.length) errors.accepted = "اكتب إجابة مقبولة واحدة على الأقل.";
    else if (mode === "math") {
      const bad = accepted.find((a) => !parse(a).ok);
      if (bad) errors.accepted = `هذه ليست عبارة رياضية مقروءة: ${bad}`;
    }
    data.mode = mode;
    data.accepted = accepted;
    if (mode === "text") data.ai = form.get("ai") === "1";
  }
  return { input: { type, text, points: Math.round(points * 100) / 100, data }, errors };
}

// ---------- التصحيح الآلي ----------

const DIACRITICS = /[ً-ْـ]/g;

/** يوحّد النص للمقارنة: الحركات والتطويل، وأشكال الألف والياء والتاء المربوطة، والمسافات، والحروف الكبيرة. */
export function normalizeText(text: string): string {
  return text
    .replace(DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,،؛!؟?]+$/g, "")
    .trim()
    .toLowerCase();
}

/** قيمة الإجابة كقائمة اختيارات (للاختيار المتعدد). */
export function choiceList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

/** هل الإجابة صحيحة؟ null للسؤال المفتوح (يصححه الأستاذ). */
export function isCorrect(q: Pick<Question, "type" | "data">, value: string): boolean | null {
  const d = questionData(q);
  const v = value.trim();
  switch (q.type) {
    case "single":
      return v !== "" && (d.correct ?? []).length === 1 && d.correct![0] === v;
    case "multiple": {
      const got = choiceList(v);
      const want = [...(d.correct ?? [])].sort();
      return got.length === want.length && got.every((x, i) => x === want[i]);
    }
    case "truefalse":
      return (v === "true" || v === "false") && (v === "true") === d.answer;
    case "numeric": {
      const got = numericValue(v);
      const want = numericValue(d.value ?? "");
      if (got === null || want === null) return false;
      const tol = d.tolerance ?? 0;
      return tol > 0 ? Math.abs(got - want) <= tol + 1e-12 : Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
    }
    case "short":
      if (!v) return false;
      if (d.mode === "math") return (d.accepted ?? []).some((a) => equivalent(v, a));
      return (d.accepted ?? []).some((a) => normalizeText(a) === normalizeText(v));
    default:
      return null;
  }
}

/** هل يُسأل الذكاء الاصطناعي عن إجابات هذا السؤال التي لم تطابق القائمة؟ */
export function usesAi(q: Pick<Question, "type" | "data">): boolean {
  if (q.type !== "short") return false;
  const d = questionData(q);
  return d.mode !== "math" && d.ai !== false;
}

export function needsManualGrading(quiz: Pick<Quiz, "allow_upload">, questions: Pick<Question, "type">[]): boolean {
  return Boolean(quiz.allow_upload) || questions.some((q) => q.type === "open");
}

// ---------- ترتيب المحاولة ----------

export interface Layout {
  q: number[];
  c: Record<string, string[]>;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function makeLayout(quiz: Pick<Quiz, "shuffle_questions" | "shuffle_choices">, questions: Question[]): Layout {
  const ordered = [...questions].sort((x, y) => x.position - y.position || x.id - y.id);
  const q = (quiz.shuffle_questions ? shuffle(ordered) : ordered).map((x) => x.id);
  const c: Record<string, string[]> = {};
  for (const question of ordered) {
    const ids = (questionData(question).choices ?? []).map((ch) => ch.id);
    if (ids.length) c[String(question.id)] = quiz.shuffle_choices ? shuffle(ids) : ids;
  }
  return { q, c };
}

export function readLayout(attempt: Pick<Attempt, "layout">): Layout {
  try {
    const l = JSON.parse(attempt.layout) as Layout;
    return { q: Array.isArray(l.q) ? l.q : [], c: l.c && typeof l.c === "object" ? l.c : {} };
  } catch {
    return { q: [], c: {} };
  }
}

/** أسئلة المحاولة بترتيبها. سؤال أُضيف بعد بدء المحاولة لا يظهر فيها. */
export function orderedQuestions(questions: Question[], layout: Layout): Question[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return layout.q.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
}

// ---------- دورة المحاولة ----------

export async function loadQuiz(db: D1Database, id: number): Promise<Quiz | null> {
  return db.prepare("SELECT * FROM quizzes WHERE id = ?").bind(id).first<Quiz>();
}

export async function loadQuestions(db: D1Database, quizId: number): Promise<Question[]> {
  const r = await db.prepare("SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id").bind(quizId).all<Question>();
  return r.results;
}

export async function loadAnswers(db: D1Database, attemptId: number): Promise<Answer[]> {
  const r = await db.prepare("SELECT * FROM answers WHERE attempt_id = ?").bind(attemptId).all<Answer>();
  return r.results;
}

export function isOpen(attempt: Pick<Attempt, "status" | "deadline_at">, now: number): boolean {
  return attempt.status === "in_progress" && (attempt.deadline_at === null || now <= attempt.deadline_at + GRACE_MS);
}

/**
 * يغلق المحاولة ويصححها آليًا: كل سؤال تلقائي يأخذ علامته، والمفتوح ينتظر الأستاذ.
 * submittedAt: وقت التسليم، أو موعد الانتهاء إن أُغلقت لانتهاء الوقت.
 */
export async function finalizeAttempt(db: D1Database, quiz: Quiz, attempt: Attempt, submittedAt: number, grader?: AiGrader): Promise<void> {
  const questions = orderedQuestions(await loadQuestions(db, quiz.id), readLayout(attempt));
  const answers = new Map((await loadAnswers(db, attempt.id)).map((a) => [a.question_id, a]));

  // الإجابات النصية التي لم تطابق قائمة الأستاذ: يُطلب فيها حكم الذكاء الاصطناعي (بالتوازي)
  const toJudge = questions.filter((q) => usesAi(q) && (answers.get(q.id)?.value ?? "").trim() !== "" && isCorrect(q, answers.get(q.id)!.value) === false);
  const judged = new Map<number, AiJudgement | null>();
  if (toJudge.length) {
    const results = await Promise.all(
      toJudge.map((q, i) =>
        grader && i < MAX_AI_PER_ATTEMPT ? judgeShortAnswer(grader, { text: q.text, accepted: questionData(q).accepted ?? [], answer: answers.get(q.id)!.value.trim() }) : Promise.resolve(null),
      ),
    );
    toJudge.forEach((q, i) => judged.set(q.id, results[i] ?? null));
  }

  const statements: D1PreparedStatement[] = [];
  let score = 0;
  let max = 0;
  let pending = false;
  let aiUsed = false;
  for (const q of questions) {
    max += q.points;
    const a = answers.get(q.id);
    let auto: number | null;
    let verdict: AiJudgement | null = null;
    if (judged.has(q.id)) {
      verdict = judged.get(q.id) ?? null;
      // تعذّر الحكم: تنتظر الإجابة تصحيح الأستاذ
      auto = verdict ? (verdict.verdict === "correct" ? q.points : 0) : null;
      if (verdict) aiUsed = true;
      else pending = true;
    } else {
      const ok = isCorrect(q, a?.value ?? "");
      auto = ok === null ? null : ok ? q.points : 0;
    }
    if (auto !== null) score += auto;
    statements.push(
      db
        .prepare(
          `INSERT INTO answers (attempt_id, question_id, value, auto_score, ai_verdict, ai_reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET auto_score = excluded.auto_score, ai_verdict = excluded.ai_verdict, ai_reason = excluded.ai_reason`,
        )
        .bind(attempt.id, q.id, a?.value ?? "", auto, verdict?.verdict ?? null, verdict?.reason || null, submittedAt),
    );
  }
  const manual = pending || needsManualGrading(quiz, questions);
  statements.push(
    db
      .prepare("UPDATE attempts SET status = ?, submitted_at = ?, score = ?, max_score = ?, graded_at = ?, ai_review = ? WHERE id = ? AND status = 'in_progress'")
      .bind(manual ? "submitted" : "graded", submittedAt, score, max, manual ? null : submittedAt, aiUsed ? 1 : 0, attempt.id),
  );
  await db.batch(statements);
}

/** إذا انتهى الوقت والمحاولة ما زالت مفتوحة: تُغلق بما حُفظ. يُرجع المحاولة محدَّثة. */
export async function closeIfExpired(db: D1Database, quiz: Quiz, attempt: Attempt, now: number, grader?: AiGrader): Promise<Attempt> {
  if (attempt.status !== "in_progress" || isOpen(attempt, now)) return attempt;
  await finalizeAttempt(db, quiz, attempt, attempt.deadline_at ?? now, grader);
  return (await db.prepare("SELECT * FROM attempts WHERE id = ?").bind(attempt.id).first<Attempt>()) ?? attempt;
}

/** يعيد حساب العلامة بعد تصحيح الأستاذ: علامته تغلب العلامة الآلية. */
export async function recomputeScore(db: D1Database, attemptId: number): Promise<void> {
  await db
    .prepare("UPDATE attempts SET score = (SELECT COALESCE(SUM(COALESCE(manual_score, auto_score, 0)), 0) FROM answers WHERE attempt_id = ?) WHERE id = ?")
    .bind(attemptId, attemptId)
    .run();
}

// ---------- ما يراه التلميذ والولي ----------

export interface Visibility {
  /** العلامة */
  score: boolean;
  /** الإجابات الصحيحة وتفاصيل كل سؤال */
  details: boolean;
}

export function visibility(quiz: Pick<Quiz, "results" | "results_released">, attempt: Pick<Attempt, "status">): Visibility {
  if (attempt.status === "in_progress") return { score: false, details: false };
  if (quiz.results === "immediate") return { score: true, details: true };
  if (quiz.results === "score") return { score: true, details: false };
  return quiz.results_released ? { score: true, details: true } : { score: false, details: false };
}

/** العلامة على 20 (السلم المعتاد في الجزائر)، مقرّبة إلى ربع نقطة. */
export function on20(score: number | null, max: number | null): string {
  if (score === null || !max) return "—";
  const v = Math.round((score / max) * 20 * 4) / 4;
  return String(v).replace(".", ",");
}

export function formatPoints(n: number | null): string {
  if (n === null) return "—";
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** يحذف اختبارات بأسئلتها ومحاولاتها، وملفات الحلول التي رفعها التلاميذ. */
export async function deleteQuizzes(db: D1Database, files: R2Bucket | undefined, quizIds: number[]): Promise<void> {
  if (!quizIds.length) return;
  const marks = quizIds.map(() => "?").join(",");
  const uploads = await db.prepare(`SELECT upload_key FROM attempts WHERE quiz_id IN (${marks}) AND upload_key IS NOT NULL`).bind(...quizIds).all<{ upload_key: string }>();
  await db.batch([
    db.prepare(`DELETE FROM lessons WHERE quiz_id IN (${marks})`).bind(...quizIds),
    db.prepare(`DELETE FROM quizzes WHERE id IN (${marks})`).bind(...quizIds),
  ]);
  if (uploads.results.length && files) await files.delete(uploads.results.map((u) => u.upload_key));
}

export interface RecentResult {
  id: number;
  student_id: number;
  student: string;
  title: string;
  status: Attempt["status"];
  score: number | null;
  max_score: number | null;
  submitted_at: number | null;
  results: ResultsMode;
  results_released: number;
}

/** آخر المحاولات المسلَّمة لأبناء معيّنين (لصفحة التلميذ وصفحة الولي). */
export async function recentResults(db: D1Database, studentIds: number[], limit = 10): Promise<RecentResult[]> {
  if (!studentIds.length) return [];
  const r = await db
    .prepare(
      `SELECT t.id, t.student_id, s.name AS student, l.title, t.status, t.score, t.max_score, t.submitted_at, q.results, q.results_released
       FROM attempts t JOIN students s ON s.id = t.student_id JOIN quizzes q ON q.id = t.quiz_id JOIN lessons l ON l.quiz_id = t.quiz_id
       WHERE t.student_id IN (${studentIds.map(() => "?").join(",")}) AND t.status != 'in_progress'
       ORDER BY t.submitted_at DESC LIMIT ?`,
    )
    .bind(...studentIds, limit)
    .all<RecentResult>();
  return r.results;
}
