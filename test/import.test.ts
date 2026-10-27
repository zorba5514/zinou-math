// اختبارات المرحلة 6.5: قراءة ملفات Excel واستيراد الأسئلة منها.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Browser, makeEnv, setupAdmin } from "./helpers/family.ts";
import { readSheet } from "../src/xlsx.ts";
import { parseQuestionRows } from "../src/quiz-import.ts";
import { questionData, type Question } from "../src/quiz.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const TEMPLATE = new Uint8Array(readFileSync(new URL("../public/templates/questions.xlsx", import.meta.url)));

test("القالب: ورقة «الأسئلة» فارغة بعناوين صحيحة، و«أمثلة» فيها سؤال من كل نوع كلها صالحة", async () => {
  const main = await readSheet(TEMPLATE, "الأسئلة");
  assert.equal(main.name, "الأسئلة");
  assert.deepEqual(main.rows[0]!.cells.slice(0, 3), ["النوع", "نص السؤال", "العلامة"]);
  assert.deepEqual(parseQuestionRows(main), { items: [], problems: [] });

  const examples = parseQuestionRows(await readSheet(TEMPLATE, "أمثلة"));
  assert.deepEqual(examples.problems, []);
  assert.deepEqual(
    examples.items.map((i) => i.input.type),
    ["single", "multiple", "truefalse", "numeric", "numeric", "short", "short", "open"],
  );
  const [single, multiple, tf, numeric, approx, text, expr] = examples.items.map((i) => i.input);
  assert.deepEqual(single!.data.correct, ["b"]);
  assert.equal(single!.data.choices!.length, 3);
  assert.deepEqual(multiple!.data.correct, ["a", "c"]);
  assert.equal(tf!.data.answer, true);
  assert.equal(numeric!.data.value, "3/4");
  assert.equal(approx!.data.tolerance, 0.01);
  assert.deepEqual(text!.data.accepted, ["متوازي الأضلاع", "parallélogramme"]);
  assert.equal(text!.data.ai, true);
  assert.equal(expr!.data.mode, "math");
  assert.equal(single!.points, 2);
  assert.match(single!.text, /\\frac\{1\}\{2\}/);
});

test("الصفوف الخاطئة تُذكر برقم صفها وسببها، والصف الفارغ يُتجاهل", async () => {
  const r = parseQuestionRows(await readSheet(fixture("questions-filled.xlsx"), "الأسئلة"));
  assert.equal(r.items.length, 8);
  assert.deepEqual(
    r.problems.map((p) => p.row),
    [10, 12, 13],
  );
  assert.match(r.problems[0]!.message, /حدّد الإجابة الصحيحة/);
  assert.match(r.problems[1]!.message, /نوع غير معروف: «نوع غريب»/);
  assert.match(r.problems[2]!.message, /اكتب عددًا/);
});

test("ملفات تكتبها برامج أخرى (نصوص داخل الخلايا، مسار مطلق، رموز XML)", async () => {
  const r = parseQuestionRows(await readSheet(fixture("questions-inline.xlsx"), "الأسئلة"));
  assert.deepEqual(r.problems, []);
  assert.equal(r.items[0]!.input.text, "المربع معين & مستطيل");
  assert.equal(r.items[0]!.input.points, 1.5);
  assert.equal(r.items[0]!.input.data.answer, true);
  assert.deepEqual(r.items[1]!.input.data.accepted, ["دائرة", "cercle"]);
});

test("حماية القارئ: ملف ليس xlsx، وقنبلة zip، وملف بغير شكل القالب", async () => {
  await assert.rejects(readSheet(new TextEncoder().encode("ليس ملفًا")), /ليس ملف Excel/);
  await assert.rejects(readSheet(fixture("zip-bomb.xlsx")), /كبير جدًا بعد فك الضغط/);
  await assert.rejects(readSheet(new Uint8Array(3 * 1024 * 1024)), /أكبر من 2 ميغابايت/);
  const sheet = { name: "x", rows: [{ row: 1, cells: ["الاسم", "اللقب"] }] };
  assert.throws(() => parseQuestionRows(sheet), /ليس بشكل قالب الأسئلة/);
});

function upload(b: Browser, quizId: number, bytes: Uint8Array, name = "أسئلة الفرض.xlsx") {
  const form = new FormData();
  form.set("file", new File([bytes.slice() as Uint8Array<ArrayBuffer>], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return b.request(`/admin/quizzes/${quizId}/import`, { method: "POST", headers: { Origin: "https://zinou.test" }, body: form });
}

async function quizSetup() {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const unitRes = await admin.post("/admin/content/2am/units", { title: "المقطع 1" });
  const unitId = Number(/units\/(\d+)/.exec(unitRes.headers.get("Location") ?? "")?.[1]);
  const quizRes = await admin.post(`/admin/units/${unitId}/quiz`, { title: "فرض المقطع 1" });
  const quizId = Number(/quizzes\/(\d+)/.exec(quizRes.headers.get("Location") ?? "")?.[1]);
  return { env, admin, quizId };
}

test("الاستيراد في الموقع: رفع ← معاينة بالأخطاء ← تأكيد يضيف الأسئلة الصالحة فقط بعد الموجودة", async () => {
  const { env, admin, quizId } = await quizSetup();
  await admin.post(`/admin/quizzes/${quizId}/new`, { type: "truefalse", text: "سؤال موجود من قبل", answer: "true" });
  const editor = await (await admin.get(`/admin/quizzes/${quizId}`)).text();
  assert.match(editor, /استيراد أسئلة من Excel/);
  assert.match(editor, /href="\/templates\/questions\.xlsx"/);

  const res = await upload(admin, quizId, fixture("questions-filled.xlsx"));
  assert.equal(res.status, 303);
  const previewUrl = res.headers.get("Location")!;
  assert.match(previewUrl, /^\/admin\/imports\/\d+$/);
  const preview = await (await admin.get(previewUrl)).text();
  assert.match(preview, /8 سؤال صالح/);
  assert.match(preview, /3 صف فيه خطأ/);
  assert.match(preview, /الصف 12/);
  assert.match(preview, /class="katex"/);
  assert.match(preview, /إضافة 8 سؤال إلى الاختبار/);
  // المعاينة لا تضيف شيئًا
  const count = () => Number(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?").get(quizId)?.n);
  assert.equal(count(), 1);

  // الولي لا يصل إلى المعاينة
  assert.notEqual((await new Browser(env).get(previewUrl)).status, 200);

  const done = await admin.post(previewUrl, { action: "confirm" });
  assert.equal(done.headers.get("Location"), `/admin/quizzes/${quizId}?done=imported&n=8#qs-title`);
  assert.equal(count(), 9);
  const rows = env.DB.raw.prepare("SELECT * FROM questions WHERE quiz_id = ? ORDER BY position").all(quizId) as unknown as Question[];
  assert.equal(rows[0]!.text, "سؤال موجود من قبل");
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(questionData(rows[2]!).correct, ["a", "c"]);
  assert.match(await (await admin.get(`/admin/quizzes/${quizId}?done=imported&n=8`)).text(), /أُضيف 8 سؤال من ملف Excel/);
  // لا تأكيد مرتين
  assert.equal((await admin.post(previewUrl, { action: "confirm" })).status, 404);
  assert.equal(count(), 9);
});

test("الاستيراد: الإلغاء لا يضيف شيئًا، والملف الخاطئ يظهر خطؤه في صفحة الاختبار", async () => {
  const { env, admin, quizId } = await quizSetup();
  const res = await upload(admin, quizId, TEMPLATE);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /لم نجد أسئلة في ورقة «الأسئلة»/);
  const bad = await upload(admin, quizId, new TextEncoder().encode("نص"), "x.xlsx");
  assert.match(await bad.text(), /ليس ملف Excel/);

  const ok = await upload(admin, quizId, fixture("questions-inline.xlsx"));
  const url = ok.headers.get("Location")!;
  const cancel = await admin.post(url, { action: "cancel" });
  assert.equal(cancel.headers.get("Location"), `/admin/quizzes/${quizId}`);
  assert.equal(Number(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM questions").get()?.n), 0);
  assert.equal(Number(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM question_imports").get()?.n), 0);
});
