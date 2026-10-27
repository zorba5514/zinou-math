// اختبارات المرحلة 6.5: مساحة المستوى بتبويباتها، وإدارة الاختبارات (إنشاء، نسخ، نقل، حذف).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Browser, FAMILY, createFamily, makeEnv, setupAdmin } from "./helpers/family.ts";

async function workspace() {
  const env = makeEnv();
  const { b: admin } = await setupAdmin(env);
  const unitIds: number[] = [];
  for (const title of ["المقطع 1: الأعداد", "المقطع 2: الهندسة"]) {
    const r = await admin.post("/admin/content/2am/units", { title });
    unitIds.push(Number(/units\/(\d+)/.exec(r.headers.get("Location") ?? "")?.[1]));
  }
  const count = (sql: string, ...args: (number | string)[]) => Number((env.DB.raw.prepare(sql).get(...args) as { n: number } | undefined)?.n);
  return { env, admin, unitIds, count };
}

test("شريط التبويبات في كل أقسام المستوى، مع الأعداد والقسم الحالي", async () => {
  const { admin } = await workspace();
  for (const [path, label] of [
    ["/admin/content/2am", "المقاطع"],
    ["/admin/content/2am/overview", "نظرة عامة"],
    ["/admin/content/2am/tests", "الاختبارات"],
    ["/admin/content/2am/students", "التلاميذ"],
    ["/admin/content/2am/results", "النتائج"],
  ] as const) {
    const res = await admin.get(path);
    assert.equal(res.status, 200, path);
    const text = await res.text();
    assert.match(text, /class="tabs"/, path);
    assert.match(text, new RegExp(`class="tab is-active" href="${path}" aria-current="page">${label}`), path);
  }
  assert.match(await (await admin.get("/admin/content/2am")).text(), /المقاطع<span class="tab-count">2</);
  // الدورات لها نفس المساحة
  const course = await admin.post("/admin/content/courses", { title: "دورة البكالوريا" });
  const slug = /content\/([a-z0-9-]+)/.exec(course.headers.get("Location") ?? "")?.[1];
  assert.equal((await admin.get(`/admin/content/${slug}/students`)).status, 200);
  // غير الأستاذ لا يصل
  assert.notEqual((await new Browser(admin.env).get("/admin/content/2am/tests")).status, 200);
});

test("اختبار جديد من تبويب الاختبارات يُرفق بالمقطع المختار، والمقطع من مستوى آخر مرفوض", async () => {
  const { env, admin, unitIds, count } = await workspace();
  const other = await admin.post("/admin/content/1am/units", { title: "مقطع من مستوى آخر" });
  const otherUnit = Number(/units\/(\d+)/.exec(other.headers.get("Location") ?? "")?.[1]);
  const bad = await admin.post("/admin/content/2am/quizzes", { title: "فرض", unit_id: String(otherUnit) });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /اختر المقطع/);
  assert.equal((await admin.post("/admin/content/2am/quizzes", { title: "", unit_id: String(unitIds[1]) })).status, 400);

  const ok = await admin.post("/admin/content/2am/quizzes", { title: "فرض الهندسة", unit_id: String(unitIds[1]) });
  assert.match(ok.headers.get("Location") ?? "", /^\/admin\/quizzes\/\d+\?done=quiz-added$/);
  assert.equal(count("SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ? AND kind = 'quiz' AND status = 'draft'", unitIds[1]), 1);

  const page = await (await admin.get("/admin/content/2am/tests")).text();
  assert.match(page, /فرض الهندسة/);
  assert.match(page, /مرتبط بـ: <a href="\/admin\/units\/\d+">2\. المقطع 2: الهندسة/);
  assert.match(page, /مسودة/);
  assert.match(page, /الاختبارات<span class="tab-count">1</);
  void env;
});

test("تصفية الاختبارات بالحالة والمقطع، ثم النسخ والنقل والحذف", async () => {
  const { env, admin, unitIds, count } = await workspace();
  const make = async (title: string, unit: number) => {
    const r = await admin.post("/admin/content/2am/quizzes", { title, unit_id: String(unit) });
    return Number(/quizzes\/(\d+)/.exec(r.headers.get("Location") ?? "")?.[1]);
  };
  const q1 = await make("فرض الأعداد", unitIds[0]!);
  await make("اختبار الهندسة", unitIds[1]!);
  await admin.post(`/admin/quizzes/${q1}/new`, { type: "truefalse", text: "0 عدد زوجي", answer: "true", points: "2" });
  await admin.post(`/admin/quizzes/${q1}/settings`, { results: "immediate", time_limit: "20" });
  const lesson1 = Number(env.DB.raw.prepare("SELECT id FROM lessons WHERE quiz_id = ?").get(q1)?.id);
  await admin.post(`/admin/lessons/${lesson1}/status`, {});

  const byUnit = await (await admin.get(`/admin/content/2am/tests?unit=${unitIds[1]}`)).text();
  assert.match(byUnit, /اختبار الهندسة/);
  assert.doesNotMatch(byUnit, /فرض الأعداد/);
  const drafts = await (await admin.get("/admin/content/2am/tests?status=draft")).text();
  assert.match(drafts, /اختبار الهندسة/);
  assert.doesNotMatch(drafts, /<a href="\/admin\/quizzes\/\d+">فرض الأعداد/);
  const all = await (await admin.get("/admin/content/2am/tests")).text();
  assert.match(all, /مصحَّح آليًا/);
  assert.match(all, /20 د/);
  assert.match(all, /صح أو خطأ/);

  // النسخ: مسودة بنفس الإعدادات والأسئلة، دون المحاولات
  const dup = await admin.post(`/admin/quizzes/${q1}/duplicate`, {});
  const copy = Number(/quizzes\/(\d+)\?done=duplicated/.exec(dup.headers.get("Location") ?? "")?.[1]);
  assert.ok(copy > q1);
  assert.equal(count("SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?", copy), 1);
  assert.equal(count("SELECT time_limit AS n FROM quizzes WHERE id = ?", copy), 20);
  const copyLesson = env.DB.raw.prepare("SELECT * FROM lessons WHERE quiz_id = ?").get(copy) as { id: number; title: string; status: string; unit_id: number };
  assert.equal(copyLesson.title, "فرض الأعداد (نسخة)");
  assert.equal(copyLesson.status, "draft");
  assert.equal(copyLesson.unit_id, unitIds[0]);

  // النقل إلى مقطع آخر من نفس المستوى، مع العودة إلى نفس التصفية
  const back = `/admin/content/2am/tests?unit=${unitIds[0]}`;
  const mv = await admin.post(`/admin/lessons/${copyLesson.id}/unit`, { unit_id: String(unitIds[1]), back });
  assert.equal(mv.headers.get("Location"), `${back}&done=moved`);
  assert.equal(count("SELECT unit_id AS n FROM lessons WHERE id = ?", copyLesson.id), unitIds[1]);
  // مقطع من مستوى آخر: لا شيء يتغير
  const other = await admin.post("/admin/content/3am/units", { title: "مقطع آخر" });
  const otherUnit = Number(/units\/(\d+)/.exec(other.headers.get("Location") ?? "")?.[1]);
  await admin.post(`/admin/lessons/${copyLesson.id}/unit`, { unit_id: String(otherUnit) });
  assert.equal(count("SELECT unit_id AS n FROM lessons WHERE id = ?", copyLesson.id), unitIds[1]);

  // الحذف من التبويب يعود إليه
  const del = await admin.post(`/admin/lessons/${copyLesson.id}/delete`, { confirm: "1", back: "/admin/content/2am/tests" });
  assert.equal(del.headers.get("Location"), "/admin/content/2am/tests?done=deleted");
  assert.equal(count("SELECT COUNT(*) AS n FROM quizzes WHERE id = ?", copy), 0);
  // عنوان عودة خارجي لا يُتبع
  const ext = await admin.post(`/admin/lessons/${lesson1}/delete`, { confirm: "1", back: "https://evil.example/" });
  assert.equal(ext.headers.get("Location"), `/admin/units/${unitIds[0]}?done=lesson-deleted`);
});

test("تبويب التلاميذ: تلاميذ المستوى فقط مع حالة اشتراكهم، ونظرة عامة بالأرقام", async () => {
  const { admin } = await workspace();
  await createFamily(admin, FAMILY);
  const page = await (await admin.get("/admin/content/2am/students")).text();
  assert.match(page, /ياسين بن علي/);
  assert.doesNotMatch(page, /مريم بن علي/);
  assert.match(page, /class="pill pill-wrap/);
  assert.match(page, /التلاميذ<span class="tab-count">1</);
  const none = await (await admin.get("/admin/content/2am/students?state=expired")).text();
  assert.doesNotMatch(none, /ياسين بن علي/);
  const ov = await (await admin.get("/admin/content/2am/overview")).text();
  assert.match(ov, /مشترك من 1 تلميذ/);
  assert.match(ov, /لا نتائج بعد/);
  assert.match(await (await admin.get("/admin/content/4am/students")).text(), /مريم بن علي/);
});
