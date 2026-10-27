// اختبارات المرحلة 6: العبارات الرياضية، والتصحيح الآلي لكل نوع، ودورة المحاولة كاملة.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Browser, FAMILY, createFamily, makeEnv, setupAdmin, type TestEnv } from "./helpers/family.ts";
import { equivalent, numericValue, parse, toLatex } from "../public/mathexpr.js";
import { isCorrect, normalizeText, on20, readQuestionForm, visibility, type Question, type QuestionType } from "../src/quiz.ts";
import { mathText } from "../src/math.ts";

const DAY = 24 * 60 * 60 * 1000;

/** رقم حساب العائلة التجريبية. */
function famOf(env: TestEnv): number {
  return Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
}

// ---------- العبارات الرياضية ----------

test("قراءة العبارات: كسور وجذور وأسس وضرب ضمني، ورسائل واضحة للأخطاء", () => {
  const cases: [string, string][] = [
    ["3/4", "\\frac{3}{4}"],
    ["0,75", "0{,}75"],
    ["√(x+1)", "\\sqrt{x+1}"],
    ["2x+3", "2x+3"],
    ["(x+1)^2", "\\left(x+1\\right)^{2}"],
    ["x²", "x^{2}"],
    ["3×4", "3\\times 4"],
    ["٣/٤", "\\frac{3}{4}"],
    ["-2x", "-2x"],
  ];
  for (const [input, latex] of cases) {
    const p = parse(input);
    assert.ok(p.ok, input);
    assert.equal(toLatex(p.ast), latex, input);
  }
  assert.equal(parse("(1").ok, false);
  assert.equal(parse("1)").ok, false);
  assert.equal(parse("2x+").ok, false);
  assert.equal(parse("").ok, false);
  assert.equal(parse("2$3").ok, false);
  assert.equal(parse("(".repeat(100)).ok, false);
});

test("مقارنة العبارات: الكتابات المساوية تُقبل، والمختلفة تُرفض", () => {
  assert.ok(equivalent("2x+3", "3+2x"));
  assert.ok(equivalent("(4x+6)/2", "2x+3"));
  assert.ok(equivalent("(x+1)^2", "x^2+2x+1"));
  assert.ok(equivalent("(a+b)(a-b)", "a^2-b^2"));
  assert.ok(equivalent("1/x", "x^-1"));
  assert.ok(!equivalent("x^2+1", "x^2+2"));
  assert.ok(!equivalent("2x", "x^2"));
  assert.ok(!equivalent("(x+1)^2", "x^2+1"));
  assert.ok(!equivalent("x", "y"));
  assert.ok(equivalent("6/8", "3/4"));
  assert.ok(!equivalent("2x+", "2x"));
});

test("الإجابة الرقمية: كسر أو عشري بالفاصلة أو جذر أو «x = 3»", () => {
  assert.equal(numericValue("3/4"), 0.75);
  assert.equal(numericValue("0,75"), 0.75);
  assert.equal(numericValue("x = 3"), 3);
  assert.equal(numericValue("-12"), -12);
  assert.ok(Math.abs((numericValue("√2") ?? 0) - Math.SQRT2) < 1e-12);
  assert.equal(numericValue("2x"), null);
  assert.equal(numericValue("abc"), null);
  assert.equal(numericValue("1/0"), null);
});

test("عرض الصيغ: ما بين $ يصير KaTeX، والباقي نص مهرَّب، والأوامر الخطرة معطلة", () => {
  const out = mathText("احسب $\\frac{3}{4}$ <script>alert(1)</script> \\$5").value;
  assert.match(out, /class="katex"/);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /\$5/);
  assert.doesNotMatch(out, /<script>/);
  const href = mathText("$\\href{javascript:alert(1)}{x}$").value;
  assert.doesNotMatch(href, /href="javascript/);
  const inside = mathText("$<img src=x onerror=alert(1)>$").value;
  assert.doesNotMatch(inside, /<img/);
});

// ---------- التصحيح ----------

function q(type: QuestionType, data: object, points = 1): Question {
  return { id: 1, quiz_id: 1, position: 1, type, text: "س", points, data: JSON.stringify(data), created_at: 0, updated_at: 0 };
}

test("التصحيح الآلي لكل نوع من الأسئلة", () => {
  const single = q("single", { choices: [{ id: "a", text: "1" }, { id: "b", text: "2" }], correct: ["b"] });
  assert.equal(isCorrect(single, "b"), true);
  assert.equal(isCorrect(single, "a"), false);
  assert.equal(isCorrect(single, ""), false);

  const multiple = q("multiple", { choices: [{ id: "a", text: "" }, { id: "b", text: "" }, { id: "c", text: "" }], correct: ["a", "c"] });
  assert.equal(isCorrect(multiple, "c,a"), true);
  assert.equal(isCorrect(multiple, "a"), false);
  assert.equal(isCorrect(multiple, "a,b,c"), false);

  const tf = q("truefalse", { answer: false });
  assert.equal(isCorrect(tf, "false"), true);
  assert.equal(isCorrect(tf, "true"), false);
  assert.equal(isCorrect(tf, ""), false);

  const numeric = q("numeric", { value: "3/4", tolerance: 0 });
  assert.equal(isCorrect(numeric, "0,75"), true);
  assert.equal(isCorrect(numeric, "6/8"), true);
  assert.equal(isCorrect(numeric, "0.7"), false);
  const approx = q("numeric", { value: "√2", tolerance: 0.01 });
  assert.equal(isCorrect(approx, "1,41"), true);
  assert.equal(isCorrect(approx, "1,4"), false);

  const text = q("short", { mode: "text", accepted: ["متوازي الأضلاع", "parallelogramme"] });
  assert.equal(isCorrect(text, "مُتوازي الاضلاع"), true);
  assert.equal(isCorrect(text, "Parallélogramme".normalize("NFD").replace(/\p{M}/gu, "")), true);
  assert.equal(isCorrect(text, "مربع"), false);

  const expr = q("short", { mode: "math", accepted: ["2x+3"] });
  assert.equal(isCorrect(expr, "3+2x"), true);
  assert.equal(isCorrect(expr, "2x+4"), false);

  assert.equal(isCorrect(q("open", {}), "أي شيء"), null);
  assert.equal(normalizeText("  أحمد   إبراهيم. "), "احمد ابراهيم");
});

test("نموذج السؤال يرفض الناقص: بلا اختيار صحيح، أو رقم غير مقروء، أو بلا إجابة مقبولة", () => {
  const form = (o: Record<string, string>) => new Map(Object.entries(o));
  assert.ok(readQuestionForm("single", form({ text: "سؤال", choice_1: "أ", choice_2: "ب" })).errors.choices);
  assert.ok(readQuestionForm("single", form({ text: "سؤال", choice_1: "أ" , correct: "1" })).errors.choices);
  assert.deepEqual(readQuestionForm("single", form({ text: "سؤال", choice_1: "أ", choice_2: "ب", correct: "2" })).input.data.correct, ["b"]);
  assert.ok(readQuestionForm("numeric", form({ text: "سؤال", value: "ثلاثة" })).errors.value);
  assert.ok(readQuestionForm("short", form({ text: "سؤال", mode: "math", accepted: "2x+(" })).errors.accepted);
  assert.ok(readQuestionForm("truefalse", form({ text: "سؤال" })).errors.answer);
  assert.ok(readQuestionForm("open", form({ text: "" })).errors.text);
  assert.ok(readQuestionForm("open", form({ text: "سؤال", points: "-1" })).errors.points);
  assert.deepEqual(readQuestionForm("open", form({ text: "سؤال", points: "2,5" })).errors, {});
});

test("ظهور النتيجة حسب إعداد الاختبار، والعلامة على 20", () => {
  const done = { status: "graded" as const };
  assert.deepEqual(visibility({ results: "immediate", results_released: 0 }, done), { score: true, details: true });
  assert.deepEqual(visibility({ results: "score", results_released: 0 }, done), { score: true, details: false });
  assert.deepEqual(visibility({ results: "released", results_released: 0 }, done), { score: false, details: false });
  assert.deepEqual(visibility({ results: "released", results_released: 1 }, done), { score: true, details: true });
  assert.deepEqual(visibility({ results: "immediate", results_released: 0 }, { status: "in_progress" }), { score: false, details: false });
  assert.equal(on20(7, 10), "14");
  assert.equal(on20(2, 3), "13,25");
  assert.equal(on20(null, 10), "—");
});

// ---------- على الخادم ----------

const ALL_QUESTIONS: [QuestionType, Record<string, string>, string][] = [
  ["single", { text: "كم يساوي $\\frac{1}{2}+\\frac{1}{4}$؟", choice_1: "$\\frac{2}{6}$", choice_2: "$\\frac{3}{4}$", correct: "2", points: "2" }, "b"],
  ["multiple", { text: "أي الأعداد أولية؟", choice_1: "2", choice_2: "4", choice_3: "7", correct_1: "1", correct_3: "1", points: "2" }, "a,c"],
  ["truefalse", { text: "العدد 0 زوجي", answer: "true", points: "1" }, "true"],
  ["numeric", { text: "احسب $3\\div 4$", value: "3/4", tolerance: "", points: "2" }, "0,75"],
  ["short", { text: "انشر $(x+1)^2$", mode: "math", accepted: "x^2+2x+1", points: "3" }, "1+2x+x²"],
  ["open", { text: "برهن أن مجموع زوايا المثلث 180°", points: "5" }, "لأن ..."],
];

interface Setup {
  env: TestEnv;
  admin: Browser;
  parent: Browser;
  quizId: number;
  lessonId: number;
  unitId: number;
  accountId: number;
  yacine: number;
  maryam: number;
  questionIds: number[];
}

/** أستاذ، وعائلة بابنين، واختبار منشور مجاني في 2 متوسط بكل أنواع الأسئلة. */
async function setup(opts: { questions?: typeof ALL_QUESTIONS; settings?: Record<string, string>; free?: boolean } = {}): Promise<Setup> {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const unitRes = await admin.post("/admin/content/2am/units", { title: "المقطع 1" });
  const unitId = Number(/units\/(\d+)/.exec(unitRes.headers.get("Location") ?? "")?.[1]);
  const quizRes = await admin.post(`/admin/units/${unitId}/quiz`, { title: "فرض المقطع 1" });
  const quizId = Number(/quizzes\/(\d+)/.exec(quizRes.headers.get("Location") ?? "")?.[1]);
  for (const [type, fields] of opts.questions ?? ALL_QUESTIONS) {
    const r = await admin.post(`/admin/quizzes/${quizId}/new`, { type, ...fields });
    assert.equal(r.status, 303, `${type}: ${r.status}`);
  }
  await admin.post(`/admin/quizzes/${quizId}/settings`, { results: "immediate", ...opts.settings });
  const lessonId = Number(env.DB.raw.prepare("SELECT id FROM lessons WHERE quiz_id = ?").get(quizId)?.id);
  await admin.post(`/admin/units/${unitId}/publish-all`, {});
  await admin.post(`/admin/units/${unitId}/status`, {});
  if (opts.free !== false) await admin.post(`/admin/lessons/${lessonId}/free`, {});

  const { password } = await createFamily(admin, FAMILY);
  const parent = new Browser(env);
  await parent.post("/login", { phone: "0661223344", password: password ?? "" });
  await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  const accountId = Number(env.DB.raw.prepare("SELECT id FROM accounts WHERE phone = '0661223344'").get()?.id);
  const kids = env.DB.raw.prepare("SELECT id FROM students WHERE account_id = ? ORDER BY id").all(accountId) as { id: number }[];
  const questionIds = (env.DB.raw.prepare("SELECT id FROM questions WHERE quiz_id = ? ORDER BY position").all(quizId) as { id: number }[]).map((r) => r.id);
  return { env, admin, parent, quizId, lessonId, unitId, accountId, yacine: kids[0]!.id, maryam: kids[1]!.id, questionIds };
}

async function asStudent(s: Setup, id = s.yacine) {
  await s.parent.post("/profiles/select", { kind: "student", student_id: String(id) });
}

async function start(s: Setup): Promise<number> {
  const r = await s.parent.post(`/quizzes/${s.quizId}/start`, {});
  const id = Number(/attempts\/(\d+)/.exec(r.headers.get("Location") ?? "")?.[1]);
  assert.ok(id > 0, `start: ${r.status} ${r.headers.get("Location")}`);
  return id;
}

function attemptRow(s: Setup, id: number) {
  return s.env.DB.raw.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as Record<string, number | string | null>;
}

test("الأستاذ ينشئ اختبارًا بكل أنواع الأسئلة، والصيغ تظهر في المحرر", async () => {
  const s = await setup();
  assert.equal(s.questionIds.length, 6);
  const page = await (await s.admin.get(`/admin/quizzes/${s.quizId}`)).text();
  assert.match(page, /class="katex"/);
  assert.match(page, /katex\.min\.css/);
  assert.match(page, /6 أسئلة · المجموع 15 نقطة/);
  // سؤال ناقص يُرفض ويبقى ما كتبه الأستاذ
  const bad = await s.admin.post(`/admin/quizzes/${s.quizId}/new`, { type: "single", text: "سؤال بلا إجابة", choice_1: "أ", choice_2: "ب" });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /سؤال بلا إجابة/);
  // الاختبار يظهر في المقطع
  assert.match(await (await new Browser(s.env).get("/levels/2am")).text(), /فرض المقطع 1/);
});

test("الاجتياز كاملًا: الحفظ أولًا بأول، ثم التسليم والتصحيح الآلي، والمفتوح ينتظر الأستاذ", async () => {
  const s = await setup();
  await asStudent(s);
  const intro = await (await s.parent.get(`/lessons/${s.lessonId}`)).text();
  assert.match(intro, /ابدأ الاختبار/);
  const id = await start(s);
  const page = await (await s.parent.get(`/attempts/${id}`)).text();
  assert.match(page, /تسليم الإجابات/);
  assert.match(page, /data-expr/);
  assert.match(page, /\/quiz\.js/);
  // لا تظهر الإجابات الصحيحة في صفحة الاجتياز
  assert.doesNotMatch(page, /x\^2\+2x\+1/);

  // الحفظ أولًا بأول لثلاثة أسئلة
  const answers = ALL_QUESTIONS.map((x) => x[2]);
  for (let i = 0; i < 3; i++) {
    const r = await s.parent.post(`/attempts/${id}/save`, { question_id: String(s.questionIds[i]), value: answers[i]! });
    assert.equal(r.status, 200);
  }
  // سؤال ليس من هذه المحاولة: مرفوض
  assert.equal((await s.parent.post(`/attempts/${id}/save`, { question_id: "99999", value: "x" })).status, 400);

  // التسليم بالباقي (والاختيار المتعدد كقيم متعددة)
  const form = new URLSearchParams();
  form.append(`q_${s.questionIds[1]}`, "a");
  form.append(`q_${s.questionIds[1]}`, "c");
  form.append(`q_${s.questionIds[3]}`, answers[3]!);
  form.append(`q_${s.questionIds[4]}`, answers[4]!);
  form.append(`q_${s.questionIds[5]}`, answers[5]!);
  const submit = await s.parent.request(`/attempts/${id}/submit`, {
    method: "POST",
    headers: { Origin: "https://zinou.test", "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  assert.equal(submit.headers.get("Location"), `/attempts/${id}?done=1`);
  const row = attemptRow(s, id);
  assert.equal(row.status, "submitted");
  assert.equal(row.score, 10);
  assert.equal(row.max_score, 15);

  const result = await (await s.parent.get(`/attempts/${id}?done=1`)).text();
  assert.match(result, /سُلّمت إجاباتك/);
  assert.match(result, /بانتظار تصحيح الأستاذ/);
  assert.match(result, /صحيح/);
  // بعد التسليم لا حفظ ولا تسليم
  assert.equal((await s.parent.post(`/attempts/${id}/save`, { question_id: String(s.questionIds[0]), value: "a" })).status, 409);

  // الأستاذ يرى المحاولة في لوحة التحكم ويصحح السؤال المفتوح
  assert.match(await (await s.admin.get("/admin")).text(), /بانتظار تصحيحك/);
  const missing = await s.admin.post(`/admin/attempts/${id}`, {});
  assert.equal(missing.status, 400);
  const tooHigh = await s.admin.post(`/admin/attempts/${id}`, { [`score_${s.questionIds[5]}`]: "9" });
  assert.equal(tooHigh.status, 400);
  const ok = await s.admin.post(`/admin/attempts/${id}`, { [`score_${s.questionIds[5]}`]: "4", [`note_${s.questionIds[5]}`]: "برهان جيد", feedback: "أحسنت" });
  assert.equal(ok.headers.get("Location"), `/admin/attempts/${id}?done=graded`);
  const graded = attemptRow(s, id);
  assert.equal(graded.status, "graded");
  assert.equal(graded.score, 14);
  const final = await (await s.parent.get(`/attempts/${id}`)).text();
  assert.match(final, /برهان جيد/);
  assert.match(final, /أحسنت/);
  assert.match(final, />18,75<small>\/20/);
  assert.doesNotMatch(await (await s.admin.get("/admin")).text(), /بانتظار تصحيحك/);
});

test("الإجابات الخاطئة: تظهر الإجابة الصحيحة في النتيجة الفورية", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(0, 5) });
  await asStudent(s);
  const id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "a", [`q_${s.questionIds[3]}`]: "0,7" });
  const row = attemptRow(s, id);
  assert.equal(row.status, "graded");
  assert.equal(row.score, 0);
  const text = await (await s.parent.get(`/attempts/${id}`)).text();
  assert.match(text, /الإجابة الصحيحة/);
  assert.match(text, /لم يُجب/);
});

test("الوقت في الخادم: بعد انتهائه يُرفض الحفظ والتسليم، وتُصحَّح الإجابات المحفوظة قبله فقط", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(0, 4), settings: { time_limit: "10" } });
  await asStudent(s);
  const id = await start(s);
  const row = attemptRow(s, id);
  assert.equal(Number(row.deadline_at) - Number(row.started_at), 10 * 60_000);
  await s.parent.post(`/attempts/${id}/save`, { question_id: String(s.questionIds[0]), value: "b" });
  // نرجع البداية 11 دقيقة إلى الوراء
  s.env.DB.raw.prepare("UPDATE attempts SET started_at = started_at - ?, deadline_at = deadline_at - ? WHERE id = ?").run(11 * 60_000, 11 * 60_000, id);
  assert.equal((await s.parent.post(`/attempts/${id}/save`, { question_id: String(s.questionIds[2]), value: "true" })).status, 409);
  const late = await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[3]}`]: "3/4" });
  assert.equal(late.headers.get("Location"), `/attempts/${id}`);
  const closed = attemptRow(s, id);
  assert.equal(closed.status, "graded");
  assert.equal(closed.score, 2);
  assert.equal(closed.submitted_at, closed.deadline_at);
});

test("عدد المحاولات المحدود، ومتابعة المحاولة الجارية بدل فتح أخرى", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(2, 3), settings: { max_attempts: "2" } });
  await asStudent(s);
  const first = await start(s);
  assert.equal(await start(s), first);
  await s.parent.post(`/attempts/${first}/submit`, { [`q_${s.questionIds[0]}`]: "false" });
  const second = await start(s);
  assert.notEqual(second, first);
  await s.parent.post(`/attempts/${second}/submit`, { [`q_${s.questionIds[0]}`]: "true" });
  const third = await s.parent.post(`/quizzes/${s.quizId}/start`, {});
  assert.equal(third.headers.get("Location"), `/lessons/${s.lessonId}`);
  assert.match(await (await s.parent.get(`/lessons/${s.lessonId}`)).text(), /استعملت كل المحاولات/);
  assert.equal(s.env.DB.raw.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.n, 2);
});

test("الصلاحيات: الولي لا يجتاز ويرى نتائج ابنه، وعائلة أخرى لا ترى المحاولة، والمدفوع يحتاج اشتراكًا", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(2, 3), free: false });
  // مدفوع وبلا اشتراك
  await asStudent(s);
  assert.equal((await s.parent.post(`/quizzes/${s.quizId}/start`, {})).headers.get("Location"), `/subscribe?lesson=${s.lessonId}`);
  // نفعّل اشتراكًا
  await s.admin.post("/admin/settings", { term1_end: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10) });
  await s.admin.post(`/admin/families/${famOf(s.env)}/activate`, { [`package_${s.yacine}`]: "2am:term1", amount: "3000", receipt: "وصل 12" });
  const id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "true" });

  // مريم (أخته) لا ترى محاولته
  await asStudent(s, s.maryam);
  assert.equal((await s.parent.get(`/attempts/${id}`)).status, 404);
  // الولي يرى النتيجة، ولا يستطيع البدء
  await s.parent.post("/profiles/select", { kind: "parent" });
  assert.equal((await s.parent.get(`/attempts/${id}`)).status, 200);
  const intro = await (await s.parent.get(`/lessons/${s.lessonId}`)).text();
  assert.match(intro, /يجتاز الاختبارَ الابنُ من ملفه/);
  assert.match(intro, /ياسين بن علي/);
  assert.equal((await s.parent.post(`/quizzes/${s.quizId}/start`, {})).headers.get("Location"), "/profiles");
  assert.equal((await s.parent.post(`/attempts/${id}/save`, { question_id: String(s.questionIds[0]), value: "x" })).status, 403);
  // زائر
  const visitor = new Browser(s.env);
  assert.match((await visitor.get(`/attempts/${id}`)).headers.get("Location") ?? "", /^\/login/);
});

test("النتائج «عندما أنشرها»: لا شيء قبل النشر، ثم العلامة والتفاصيل", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(2, 3), settings: { results: "released" } });
  await asStudent(s);
  const id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "true" });
  let page = await (await s.parent.get(`/attempts/${id}`)).text();
  assert.match(page, /تظهر النتيجة عندما ينشرها الأستاذ/);
  assert.doesNotMatch(page, /big-score/);
  const release = await s.admin.post(`/admin/quizzes/${s.quizId}/release`, {});
  assert.equal(release.headers.get("Location"), `/admin/quizzes/${s.quizId}/results?done=released`);
  page = await (await s.parent.get(`/attempts/${id}`)).text();
  assert.match(page, /big-score/);
  assert.match(page, />20</);
});

test("المسودة لا تُجتاز، وحذف الاختبار يحذف أسئلته ومحاولاته", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(2, 3) });
  await asStudent(s);
  const id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "true" });
  await s.admin.post(`/admin/lessons/${s.lessonId}/status`, {});
  assert.equal((await s.parent.get(`/lessons/${s.lessonId}`)).status, 404);
  assert.equal((await s.parent.post(`/quizzes/${s.quizId}/start`, {})).status, 404);
  await s.admin.post(`/admin/lessons/${s.lessonId}/delete`, { confirm: "1" });
  for (const table of ["quizzes", "questions", "attempts", "answers", "lessons"]) {
    assert.equal(s.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0, table);
  }
});

test("خلط الأسئلة والاختيارات: كل تلميذ بترتيبه، وكل الأسئلة موجودة", async () => {
  const many: typeof ALL_QUESTIONS = Array.from({ length: 8 }, (_, i) => [
    "single",
    { text: `سؤال ${i + 1}`, choice_1: "أ", choice_2: "ب", choice_3: "ج", choice_4: "د", correct: "1" },
    "a",
  ]);
  const s = await setup({ questions: many, settings: { shuffle_questions: "1", shuffle_choices: "1" } });
  await asStudent(s);
  const id = await start(s);
  const layout = JSON.parse(String(attemptRow(s, id).layout)) as { q: number[]; c: Record<string, string[]> };
  assert.deepEqual([...layout.q].sort((a, b) => a - b), [...s.questionIds].sort((a, b) => a - b));
  for (const qid of s.questionIds) assert.deepEqual([...layout.c[String(qid)]!].sort(), ["a", "b", "c", "d"]);
  // الإجابة الصحيحة تُصحَّح بمعرّف الاختيار لا بموضعه
  await s.parent.post(`/attempts/${id}/submit`, Object.fromEntries(s.questionIds.map((qid) => [`q_${qid}`, "a"])));
  assert.equal(attemptRow(s, id).score, 8);
});

test("رفع ملف الحل: PDF حتى 5 ميغابايت، يراه الأستاذ وصاحبه فقط", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(5), settings: { allow_upload: "1" } });
  const store = new Map<string, Uint8Array>();
  s.env.FILES = {
    async put(k, v) {
      store.set(k, v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));
    },
    async get(k) {
      const v = store.get(k);
      return v ? { body: new Blob([new Uint8Array(v)]).stream(), size: v.length } : null;
    },
    async delete(k) {
      for (const x of Array.isArray(k) ? k : [k]) store.delete(x);
    },
  };
  await asStudent(s);
  const id = await start(s);
  const send = (bytes: Uint8Array) => {
    const form = new FormData();
    form.set(`q_${s.questionIds[0]}`, "انظر الملف");
    form.set("solution", new File([new Uint8Array(bytes)], "حلي.pdf", { type: "application/pdf" }));
    return s.parent.request(`/attempts/${id}/submit`, { method: "POST", headers: { Origin: "https://zinou.test" }, body: form });
  };
  const notPdf = await send(new TextEncoder().encode("hello"));
  assert.equal(notPdf.status, 400);
  assert.match(await notPdf.text(), /يجب أن يكون PDF/);
  const big = new Uint8Array(5 * 1024 * 1024 + 10);
  big.set(new TextEncoder().encode("%PDF-"));
  assert.equal((await send(big)).status, 400);
  const ok = await send(new TextEncoder().encode("%PDF-1.4 حل"));
  assert.equal(ok.headers.get("Location"), `/attempts/${id}?done=1`);
  assert.equal(store.size, 1);
  assert.equal(attemptRow(s, id).upload_name, "حلي.pdf");

  assert.equal((await s.parent.get(`/attempts/${id}/upload`)).headers.get("Content-Type"), "application/pdf");
  assert.equal((await s.admin.get(`/attempts/${id}/upload`)).status, 200);
  await asStudent(s, s.maryam);
  assert.equal((await s.parent.get(`/attempts/${id}/upload`)).status, 404);
  // حذف الاختبار يحذف ملف الحل
  await s.admin.post(`/admin/lessons/${s.lessonId}/delete`, { confirm: "1" });
  assert.equal(store.size, 0);
});

test("النتائج تظهر في صفحة التلميذ وصفحة الولي، والمخفية لا تُكشف علامتها", async () => {
  const s = await setup({ questions: ALL_QUESTIONS.slice(2, 3), settings: { results: "released" } });
  await asStudent(s);
  const id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "true" });
  let home = await (await s.parent.get("/home")).text();
  assert.match(home, /نتائجي الأخيرة/);
  assert.match(home, /فرض المقطع 1/);
  assert.match(home, /لم تُنشر بعد/);
  await s.admin.post(`/admin/quizzes/${s.quizId}/release`, {});
  home = await (await s.parent.get("/home")).text();
  assert.match(home, />20\/20<\/bdi>/);
  await s.parent.post("/profiles/select", { kind: "parent" });
  const account = await (await s.parent.get("/account")).text();
  assert.match(account, /نتائج الاختبارات/);
  assert.match(account, /ياسين بن علي · فرض المقطع 1/);
});

// ---------- الذكاء الاصطناعي للإجابات القصيرة ----------

const TEXT_Q: typeof ALL_QUESTIONS = [
  ["short", { text: "ما اسم الرباعي الذي فيه كل ضلعين متقابلين متوازيين؟", mode: "text", accepted: "متوازي الأضلاع", ai: "1", points: "2" }, ""],
  ["short", { text: "ما اسم المستقيم العمودي على قطعة في منتصفها؟", mode: "text", accepted: "محور القطعة", points: "2" }, ""],
];

/** ذكاء اصطناعي وهمي: يحكم حسب الإجابة، ويسجّل ما وصله. */
function fakeAi(decide: (answer: string) => unknown) {
  const calls: string[] = [];
  return {
    calls,
    async run(_model: string, input: unknown) {
      const content = (input as { messages: { content: string }[] }).messages[1]!.content;
      const answer = /<student_answer>([\s\S]*)<\/student_answer>/.exec(content)?.[1] ?? "";
      calls.push(answer);
      return decide(answer);
    },
  };
}

test("قراءة حكم الذكاء الاصطناعي: JSON داخل نص، أو كائن جاهز، والرد غير المفهوم يُرفض", async () => {
  const { parseJudgement } = await import("../src/ai-grade.ts");
  assert.deepEqual(parseJudgement({ response: 'الحكم: {"correct": true, "reason": "نفس المعنى"}' }), { verdict: "correct", reason: "نفس المعنى" });
  assert.deepEqual(parseJudgement({ response: { correct: false, reason: "مختلف" } }), { verdict: "wrong", reason: "مختلف" });
  assert.equal(parseJudgement({ response: "لا أعرف" }), null);
  assert.equal(parseJudgement({ response: '{"correct": "ربما"}' }), null);
  assert.equal(parseJudgement(null), null);
});

test("خانة الذكاء الاصطناعي في السؤال النصي: مفعّلة افتراضيًا وتُطفأ، ولا تخص العبارة الرياضية", () => {
  const on = readQuestionForm("short", new Map([["text", "س"], ["mode", "text"], ["accepted", "أ"], ["ai", "1"]]));
  assert.equal(on.input.data.ai, true);
  const off = readQuestionForm("short", new Map([["text", "س"], ["mode", "text"], ["accepted", "أ"]]));
  assert.equal(off.input.data.ai, false);
  const math = readQuestionForm("short", new Map([["text", "س"], ["mode", "math"], ["accepted", "2x"], ["ai", "1"]]));
  assert.equal(math.input.data.ai, undefined);
});

test("الذكاء الاصطناعي يحكم فورًا على الإجابة غير الموجودة في القائمة، وتظهر للأستاذ للمراجعة", async () => {
  const s = await setup({ questions: TEXT_Q.slice(0, 1) });
  const ai = fakeAi((a) => ({ response: a.includes("متوازى") ? '{"correct": true, "reason": "خطأ إملائي بسيط"}' : '{"correct": false, "reason": "شكل آخر"}' }));
  s.env.AI = ai;
  await asStudent(s);
  // إجابة تطابق القائمة: لا يُسأل الذكاء الاصطناعي
  let id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "متوازي الاضلاع" });
  assert.equal(ai.calls.length, 0);
  assert.equal(attemptRow(s, id).score, 2);
  assert.equal(attemptRow(s, id).ai_review, 0);

  // إجابة بصياغة أخرى: يحكم فورًا، والمحاولة مصححة لكن معلَّمة للمراجعة
  await s.admin.post(`/admin/quizzes/${s.quizId}/settings`, { results: "immediate", max_attempts: "" });
  id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "متوازى الاضلاع ABCD" });
  assert.deepEqual(ai.calls, ["متوازى الاضلاع ABCD"]);
  let row = attemptRow(s, id);
  assert.equal(row.status, "graded");
  assert.equal(row.score, 2);
  assert.equal(row.ai_review, 1);
  assert.match(await (await s.parent.get(`/attempts/${id}`)).text(), /صحيح/);

  const dash = await (await s.admin.get("/admin")).text();
  assert.match(dash, /راجع حكم الذكاء الاصطناعي/);
  const page = await (await s.admin.get(`/admin/attempts/${id}`)).text();
  assert.match(page, /حكم الذكاء الاصطناعي: صحيحة/);
  assert.match(page, /خطأ إملائي بسيط/);
  assert.match(page, /أضفها إلى الإجابات المقبولة/);
  assert.match(await (await s.admin.get(`/admin/quizzes/${s.quizId}/results`)).text(), /للمراجعة/);

  // الأستاذ يراجع ويصحح بعلامته: تغلب، وتزول علامة المراجعة
  await s.admin.post(`/admin/attempts/${id}`, { [`score_${s.questionIds[0]}`]: "1" });
  row = attemptRow(s, id);
  assert.equal(row.score, 1);
  assert.equal(row.ai_review, 0);
  assert.doesNotMatch(await (await s.admin.get("/admin")).text(), /راجع حكم الذكاء الاصطناعي/);
});

test("إضافة إجابة التلميذ إلى المقبولة تصحح بها كل المحاولات التي كتبتها", async () => {
  const s = await setup({ questions: TEXT_Q.slice(0, 1), settings: { max_attempts: "" } });
  s.env.AI = fakeAi(() => ({ response: '{"correct": false, "reason": "ليست في القائمة"}' }));
  const ids: number[] = [];
  for (const kid of [s.yacine, s.maryam]) {
    await asStudent(s, kid);
    const id = await start(s);
    await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "Parallélogramme" });
    ids.push(id);
    assert.equal(attemptRow(s, id).score, 0);
  }
  const r = await s.admin.post(`/admin/attempts/${ids[0]}/accept/${s.questionIds[0]}`, {});
  assert.equal(r.headers.get("Location"), `/admin/attempts/${ids[0]}?done=accepted`);
  for (const id of ids) assert.equal(attemptRow(s, id).score, 2);
  const data = JSON.parse(String(s.env.DB.raw.prepare("SELECT data FROM questions WHERE id = ?").get(s.questionIds[0])?.data));
  assert.deepEqual(data.accepted, ["متوازي الأضلاع", "Parallélogramme"]);
  // التلميذ والولي لا يصلون إلى هذا المسار
  const parentTry = await s.parent.post(`/admin/attempts/${ids[0]}/accept/${s.questionIds[0]}`, {});
  assert.notEqual(parentTry.headers.get("Location"), `/admin/attempts/${ids[0]}?done=accepted`);
});

test("تعذّر الذكاء الاصطناعي (خطأ أو تأخر أو غير مربوط): لا تخمين، الإجابة تنتظر الأستاذ", async () => {
  for (const ai of [
    { async run(): Promise<unknown> { throw new Error("quota"); } },
    { async run(): Promise<unknown> { return { response: "لا أدري" }; } },
    undefined,
  ]) {
    const s = await setup({ questions: TEXT_Q });
    s.env.AI = ai;
    await asStudent(s);
    const id = await start(s);
    await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "مستطيل", [`q_${s.questionIds[1]}`]: "محور القطعة" });
    const row = attemptRow(s, id);
    assert.equal(row.status, "submitted");
    assert.equal(row.score, 2);
    assert.equal(row.ai_review, 0);
    const page = await (await s.admin.get(`/admin/attempts/${id}`)).text();
    assert.match(page, /لم يتمكن الذكاء الاصطناعي من الحكم/);
  }
});

test("السؤال الذي أُطفئ فيه الذكاء الاصطناعي: الإجابة غير الموجودة في القائمة خاطئة مباشرة", async () => {
  const s = await setup({ questions: [["short", { text: "ما اسم هذا المستقيم؟", mode: "text", accepted: "محور القطعة", points: "2" }, ""]] });
  const ai = fakeAi(() => ({ response: '{"correct": true}' }));
  s.env.AI = ai;
  await asStudent(s);
  const id = await start(s);
  await s.parent.post(`/attempts/${id}/submit`, { [`q_${s.questionIds[0]}`]: "المحور" });
  assert.equal(ai.calls.length, 0);
  assert.equal(attemptRow(s, id).status, "graded");
  assert.equal(attemptRow(s, id).score, 0);
});
