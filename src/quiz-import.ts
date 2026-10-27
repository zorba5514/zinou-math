// استيراد أسئلة اختبار من ملف Excel (القالب في public/templates/questions.xlsx).
//
// الخطوات: يرفع الأستاذ الملف ← نقرأ كل صف ونتحقق منه بنفس قواعد نموذج السؤال ← تُحفظ النتيجة مؤقتًا
// ← صفحة معاينة فيها الأسئلة كما ستظهر والأخطاء برقم الصف ← لا يُضاف شيء قبل أن يؤكد الأستاذ.
// الأعمدة يجب أن تطابق scripts/make-questions-template.py.

import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox } from "./ui.ts";
import { adminLayout } from "./admin-pages.ts";
import { audit } from "./db.ts";
import { field, page, readForm, readUpload, redirect } from "./http.ts";
import { notFoundPage } from "./pages.ts";
import { MAX_XLSX_BYTES, XlsxError, readSheet, type Sheet } from "./xlsx.ts";
import { QUESTION_TYPES, formatPoints, normalizeText, readQuestionForm, type Question, type QuestionInput, type QuestionType } from "./quiz.ts";
import type { Ctx } from "./auth-routes.ts";

export const TEMPLATE_URL = "/templates/questions.xlsx";
export const MAX_IMPORT_QUESTIONS = 200;
/** المعاينات التي لم تُؤكد تُحذف بعد يوم. */
const IMPORT_TTL_MS = 24 * 60 * 60 * 1000;

const COL = { type: 0, text: 1, points: 2, choice1: 3, answer: 9, tolerance: 10, ai: 11 } as const;

/** أسماء الأنواع كما في القائمة المنسدلة (وبعض الصيغ القريبة)، بعد التوحيد. */
const TYPE_NAMES: Record<string, { type: QuestionType; mode?: "text" | "math" }> = {};
for (const [names, value] of [
  [["اختيار واحد", "اختيار وحيد", "single"], { type: "single" }],
  [["اختيار متعدد", "اختيارات متعددة", "multiple"], { type: "multiple" }],
  [["صح أو خطأ", "صح او خطا", "صح/خطأ", "truefalse"], { type: "truefalse" }],
  [["إجابة رقمية", "رقمية", "numeric"], { type: "numeric" }],
  [["إجابة نصية", "إجابة قصيرة", "نصية", "text"], { type: "short", mode: "text" }],
  [["عبارة رياضية", "math"], { type: "short", mode: "math" }],
  [["سؤال مفتوح", "مفتوح", "open"], { type: "open" }],
] as [string[], { type: QuestionType; mode?: "text" | "math" }][]) {
  for (const n of names) TYPE_NAMES[normalizeText(n)] = value;
}

const TRUE_WORDS = new Set(["صح", "صحيح", "صحيحه", "نعم", "true", "vrai", "1"].map(normalizeText));
const FALSE_WORDS = new Set(["خطا", "خطأ", "خاطئ", "خاطئه", "لا", "false", "faux", "0"].map(normalizeText));

/** الأرقام العربية المشرقية (١٢٣) إلى 123. */
function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export interface ImportItem {
  row: number;
  input: QuestionInput;
}
export interface ImportProblem {
  row: number;
  message: string;
}
export interface ImportResult {
  items: ImportItem[];
  problems: ImportProblem[];
}

/** يحوّل صفًا إلى نفس خانات نموذج السؤال، فيُتحقق منه بنفس القواعد تمامًا. */
function rowToForm(cells: string[]): { type: QuestionType; form: Map<string, string> } | string {
  const c = (i: number) => cells[i] ?? "";
  const kind = TYPE_NAMES[normalizeText(c(COL.type))];
  if (!c(COL.type)) return "اختر نوع السؤال في العمود الأول.";
  if (!kind) return `نوع غير معروف: «${c(COL.type).slice(0, 40)}». اختره من القائمة المنسدلة.`;
  const form = new Map<string, string>([
    ["text", c(COL.text)],
    ["points", westernDigits(c(COL.points)) || "1"],
  ]);
  const answer = c(COL.answer);
  if (kind.type === "single" || kind.type === "multiple") {
    const choices: string[] = [];
    for (let i = 0; i < 6; i++) {
      form.set(`choice_${i + 1}`, c(COL.choice1 + i));
      choices.push(c(COL.choice1 + i));
    }
    // رقم الاختيار، أو نص الاختيار نفسه
    const toIndex = (s: string): number => {
      const n = Number(westernDigits(s.trim()));
      if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
      const k = choices.findIndex((ch) => ch && normalizeText(ch) === normalizeText(s));
      return k >= 0 ? k + 1 : 0;
    };
    if (kind.type === "single") {
      const n = answer ? toIndex(answer) : 0;
      if (answer && !n) return `الإجابة الصحيحة «${answer.slice(0, 40)}» ليست رقم اختيار (من 1 إلى 6).`;
      if (n && !choices[n - 1]) return `الإجابة الصحيحة هي الاختيار ${n}، لكن خانته فارغة.`;
      if (n) form.set("correct", String(n));
    } else {
      for (const part of answer.split(/[,،;؛\s]+/).filter(Boolean)) {
        const n = toIndex(part);
        if (!n) return `الإجابات الصحيحة «${answer.slice(0, 40)}»: اكتب أرقام الاختيارات مفصولة بفاصلة، مثل 1، 3.`;
        if (!choices[n - 1]) return `الاختيار ${n} محدد كإجابة صحيحة، لكن خانته فارغة.`;
        form.set(`correct_${n}`, "1");
      }
    }
  } else if (kind.type === "truefalse") {
    const a = normalizeText(answer);
    if (TRUE_WORDS.has(a)) form.set("answer", "true");
    else if (FALSE_WORDS.has(a)) form.set("answer", "false");
    else if (answer) return `الإجابة «${answer.slice(0, 40)}»: اكتب صح أو خطأ.`;
  } else if (kind.type === "numeric") {
    form.set("value", westernDigits(answer));
    form.set("tolerance", westernDigits(c(COL.tolerance)));
  } else if (kind.type === "short") {
    form.set("mode", kind.mode ?? "text");
    form.set("accepted", answer.split(/\r?\n|\|/).map((s) => s.trim()).filter(Boolean).join("\n"));
    if (!FALSE_WORDS.has(normalizeText(c(COL.ai)))) form.set("ai", "1");
  }
  return { type: kind.type, form };
}

/** يقرأ ورقة الأسئلة. يرمي XlsxError برسالة واضحة إن لم تكن بشكل القالب. */
export function parseQuestionRows(sheet: Sheet): ImportResult {
  const header = sheet.rows.findIndex((r) => r.cells.some((x) => x));
  if (header < 0 || normalizeText(sheet.rows[header]!.cells[0] ?? "") !== normalizeText("النوع") || normalizeText(sheet.rows[header]!.cells[1] ?? "") !== normalizeText("نص السؤال")) {
    throw new XlsxError("هذا الملف ليس بشكل قالب الأسئلة: يجب أن يكون العمود الأول «النوع» والثاني «نص السؤال». حمّل القالب واملأه.");
  }
  const items: ImportItem[] = [];
  const problems: ImportProblem[] = [];
  for (const r of sheet.rows.slice(header + 1)) {
    if (!r.cells.some((x) => x)) continue;
    if (items.length >= MAX_IMPORT_QUESTIONS) {
      problems.push({ row: r.row, message: `الحد ${MAX_IMPORT_QUESTIONS} سؤال في الملف الواحد: الصفوف التالية لم تُقرأ.` });
      break;
    }
    const parsed = rowToForm(r.cells);
    if (typeof parsed === "string") {
      problems.push({ row: r.row, message: parsed });
      continue;
    }
    const { input, errors } = readQuestionForm(parsed.type, parsed.form);
    const messages = Object.values(errors);
    if (messages.length) problems.push({ row: r.row, message: messages.join(" ") });
    else items.push({ row: r.row, input });
  }
  return { items, problems };
}

// ---------- المسارات ----------

interface ImportRow {
  id: number;
  quiz_id: number;
  file_name: string | null;
  items: string;
  problems: string;
  created_at: number;
}

/** بطاقة الاستيراد في صفحة الاختبار. */
export function importCard(quizId: number): Raw {
  return html`<div class="card form-card import-card">
  <h3>${icon("sheet")} استيراد أسئلة من Excel</h3>
  <p class="muted small">املأ القالب (سؤال في كل صف)، ثم ارفعه. تظهر لك معاينة قبل الإضافة.</p>
  <p><a class="btn btn-secondary btn-sm" href="${TEMPLATE_URL}" download="قالب-الأسئلة.xlsx">${icon("download", "icon icon-sm")}تحميل القالب</a></p>
  <form method="post" action="/admin/quizzes/${String(quizId)}/import" enctype="multipart/form-data" class="form upload-form">
    <label class="field"><span class="label">ملف الأسئلة (xlsx، حتى 2 ميغابايت)</span>
      <input class="input" type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label>
    <button class="btn btn-primary btn-sm" type="submit">${icon("upload", "icon icon-sm")}رفع ومعاينة</button>
  </form>
</div>`;
}

/** POST /admin/quizzes/:id/import */
export async function uploadImport(ctx: Ctx, quizId: number, back: (error: string) => Promise<Response>): Promise<Response> {
  const db = ctx.env.DB;
  const upload = await readUpload(ctx.request, MAX_XLSX_BYTES);
  if (upload.tooLarge) return back("الملف أكبر من 2 ميغابايت.");
  if (!upload.file) return back("اختر ملف Excel.");
  let result: ImportResult;
  try {
    const sheet = await readSheet(new Uint8Array(await upload.file.arrayBuffer()), "الأسئلة");
    result = parseQuestionRows(sheet);
  } catch (err) {
    return back(err instanceof XlsxError ? err.message : "تعذرت قراءة الملف. تأكد أنه ملف Excel بصيغة xlsx.");
  }
  if (!result.items.length && !result.problems.length) return back("لم نجد أسئلة في ورقة «الأسئلة». اكتب سؤالًا في كل صف ابتداءً من الصف 2.");
  await db.prepare("DELETE FROM question_imports WHERE created_at < ?").bind(ctx.now - IMPORT_TTL_MS).run();
  const row = await db
    .prepare("INSERT INTO question_imports (quiz_id, file_name, items, problems, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(quizId, upload.file.name.slice(0, 120) || null, JSON.stringify(result.items), JSON.stringify(result.problems), ctx.user?.account.id ?? null, ctx.now)
    .first<{ id: number }>();
  return redirect(`/admin/imports/${row?.id ?? 0}`);
}

export interface ImportPageContext {
  crumbs: Raw;
  title: string;
  quizId: number;
  preview: (q: Question) => Raw;
}

/** GET و POST /admin/imports/:id */
export async function handleImport(ctx: Ctx, id: number, load: (quizId: number) => Promise<ImportPageContext | null>): Promise<Response> {
  const db = ctx.env.DB;
  const imp = await db.prepare("SELECT * FROM question_imports WHERE id = ? AND created_at >= ?").bind(id, ctx.now - IMPORT_TTL_MS).first<ImportRow>();
  const c = imp ? await load(imp.quiz_id) : null;
  if (!imp || !c) return page(notFoundPage(ctx.view), 404);
  const items = JSON.parse(imp.items) as ImportItem[];
  const problems = JSON.parse(imp.problems) as ImportProblem[];

  if (ctx.method === "POST") {
    const form = await readForm(ctx.request);
    if (field(form, "action") === "confirm" && items.length) {
      // الأسئلة تحققنا منها عند الرفع وحفظناها نحن في قاعدة البيانات؛ هنا فحص بسيط للأنواع والأطوال فقط
      const statements = [];
      const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) AS n FROM questions WHERE quiz_id = ?").bind(c.quizId).first<{ n: number }>();
      let p = pos?.n ?? 0;
      for (const it of items) {
        if (!(it.input.type in QUESTION_TYPES)) continue;
        statements.push(
          db
            .prepare("INSERT INTO questions (quiz_id, position, type, text, points, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(c.quizId, ++p, it.input.type, String(it.input.text).slice(0, 3000), Number(it.input.points) || 1, JSON.stringify(it.input.data ?? {}), ctx.now, ctx.now),
        );
      }
      statements.push(db.prepare("DELETE FROM question_imports WHERE id = ?").bind(imp.id));
      await db.batch(statements);
      await audit(db, ctx.user?.account.id ?? null, "quiz.questions_imported", `quiz:${c.quizId}`, `${c.title}: ${items.length}`);
      return redirect(`/admin/quizzes/${c.quizId}?done=imported&n=${items.length}#qs-title`);
    }
    await db.prepare("DELETE FROM question_imports WHERE id = ?").bind(imp.id).run();
    return redirect(`/admin/quizzes/${c.quizId}`);
  }

  const total = items.reduce((s, it) => s + it.input.points, 0);
  return page(
    adminLayout(
      ctx.view,
      `معاينة الاستيراد: ${c.title}`,
      "content",
      html`${c.crumbs}
<header class="page-head">
  <h1>معاينة الأسئلة المستوردة</h1>
  <p class="muted">${imp.file_name ? html`<bdi>${imp.file_name}</bdi> · ` : ""}${items.length} سؤال صالح${items.length ? html` · المجموع ${formatPoints(total)} نقطة` : ""}${problems.length ? html` · ${problems.length} صف فيه خطأ` : ""}</p>
</header>
${
  problems.length
    ? html`<section class="card form-card import-problems" aria-labelledby="pr-title">
  <h2 id="pr-title">${icon("alert")} صفوف لن تُستورد</h2>
  <p class="muted small">صحّحها في الملف ثم ارفعه من جديد، أو استورد الأسئلة الصالحة الآن وأضف الباقي لاحقًا.</p>
  <ul class="problem-list">${problems.map((p) => html`<li><span class="pill pill-danger">الصف ${p.row}</span> ${p.message}</li>`)}</ul>
</section>`
    : ""
}
${
  items.length
    ? html`<ol class="q-list">${items.map(
        (it, i) => html`<li class="card q-card">
    <div class="q-head"><span class="unit-num">${i + 1}</span><span class="pill pill-muted">${QUESTION_TYPES[it.input.type]}</span><span class="pill pill-muted">${formatPoints(it.input.points)} ن</span><span class="muted small">الصف ${it.row}</span></div>
    ${c.preview({ id: 0, quiz_id: c.quizId, position: i + 1, type: it.input.type, text: it.input.text, points: it.input.points, data: JSON.stringify(it.input.data), created_at: 0, updated_at: 0 })}
  </li>`,
      )}</ol>`
    : alertBox("لا يوجد سؤال صالح في الملف.")
}
<form method="post" action="/admin/imports/${String(imp.id)}" class="actions import-actions">
  ${items.length ? html`<button class="btn btn-primary" type="submit" name="action" value="confirm">${icon("check")}إضافة ${items.length} سؤال إلى الاختبار</button>` : ""}
  <button class="btn btn-secondary" type="submit" name="action" value="cancel">إلغاء</button>
</form>`,
      ["/katex/katex.min.js"],
    ),
  );
}
