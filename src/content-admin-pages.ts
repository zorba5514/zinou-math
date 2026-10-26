// صفحات إدارة المحتوى في لوحة التحكم: المستويات والدورات، والمقاطع، والدروس.

import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, select, textarea, type View } from "./ui.ts";
import { adminLayout, when } from "./admin-pages.ts";
import { KIND_LABELS, formatSize, unitWord, type Lesson, type Program, type ProgramSummary, type Unit, type UnitWithLessons } from "./content.ts";

export const FILE_MODE_OPTIONS = [
  { value: "both", label: "عرض وتحميل" },
  { value: "view", label: "عرض فقط (بدون زر تحميل)" },
  { value: "download", label: "تحميل فقط" },
];

function statusPill(status: "draft" | "published"): Raw {
  return status === "published"
    ? html`<span class="pill pill-success">منشور</span>`
    : html`<span class="pill pill-warning">مسودة</span>`;
}

function freePill(free: number): Raw {
  return free ? html`<span class="pill pill-success">مجاني</span>` : html`<span class="pill pill-muted">مدفوع</span>`;
}

/** زر صغير يرسل نموذجًا بلا حقول. */
function postButton(action: string, label: Raw | string, className = "btn btn-secondary btn-sm", aria?: string): Raw {
  return html`<form method="post" action="${action}" class="inline-form"><button class="${className}" type="submit"${aria ? html` aria-label="${aria}" title="${aria}"` : ""}>${label}</button></form>`;
}

function moveButtons(base: string, first: boolean, last: boolean): Raw {
  return html`<span class="move-btns">
    ${first ? html`<span class="icon-btn icon-btn-off" aria-hidden="true">${icon("arrowUp", "icon icon-sm")}</span>` : html`<form method="post" action="${base}/move" class="inline-form"><input type="hidden" name="dir" value="up"><button class="icon-btn" type="submit" aria-label="تقديم" title="تقديم">${icon("arrowUp", "icon icon-sm")}</button></form>`}
    ${last ? html`<span class="icon-btn icon-btn-off" aria-hidden="true">${icon("arrowDown", "icon icon-sm")}</span>` : html`<form method="post" action="${base}/move" class="inline-form"><input type="hidden" name="dir" value="down"><button class="icon-btn" type="submit" aria-label="تأخير" title="تأخير">${icon("arrowDown", "icon icon-sm")}</button></form>`}
  </span>`;
}

const DONE: Record<string, string> = {
  "course-added": "أُضيفت الدورة.",
  "course-saved": "حُفظ اسم الدورة.",
  "unit-added": "أُضيف المقطع كمسودة.",
  "unit-saved": "حُفظ الاسم.",
  "unit-published": "نُشر. يظهر الآن في الموقع.",
  "unit-hidden": "أصبح مسودة. لم يعد يظهر في الموقع.",
  "unit-deleted": "حُذف مع دروسه.",
  "lesson-added": "أُضيف الدرس كمسودة.",
  "lesson-saved": "حُفظ الدرس.",
  "lesson-deleted": "حُذف الدرس.",
  "all-published": "نُشرت كل الدروس.",
  "course-deleted": "حُذفت الدورة.",
};

export function doneMessage(key: string | null): string | null {
  return key ? (DONE[key] ?? null) : null;
}

// ---------- كل المستويات والدورات ----------

export function contentHomePage(view: View, programs: ProgramSummary[], o: { done?: string | null; errors?: Record<string, string>; values?: Record<string, string> } = {}): string {
  const e = o.errors ?? {};
  const row = (p: ProgramSummary) => html`<li>
  <a class="card program-card" href="/admin/content/${p.slug}">
    <span class="icon-box${p.kind === "course" ? " icon-box-ink" : ""}">${icon(p.icon)}</span>
    <span class="program-title">${p.title}</span>
    <span class="program-meta">${p.units} ${unitWord(p, true)} · ${p.lessons} درسًا</span>
  </a>
</li>`;
  return adminLayout(
    view,
    "المحتوى",
    "content",
    html`<header class="page-head">
  <h1>المحتوى</h1>
  <p class="muted">اختر مستوى أو دورة لإضافة المقاطع والدروس. كل ما تضيفه يبقى مسودة حتى تنشره.</p>
</header>
${alertBox(doneMessage(o.done ?? null), "success")}
<section class="section" aria-labelledby="lv"><h2 id="lv">المستويات</h2><ul class="card-grid">${programs.filter((p) => p.kind === "level").map(row)}</ul></section>
<section class="section" aria-labelledby="cs"><h2 id="cs">الدورات</h2><ul class="card-grid">${programs.filter((p) => p.kind === "course").map(row)}</ul></section>
<section class="card form-card section">
  <h2>إضافة دورة</h2>
  <form method="post" action="/admin/content/courses" class="form" novalidate>
    ${input({ name: "title", label: "اسم الدورة", value: o.values?.title, required: true, error: e.title, maxlength: 80 })}
    ${select({ name: "icon", label: "الأيقونة", options: [{ value: "trophy", label: "كأس" }, { value: "calculator", label: "آلة حاسبة" }, { value: "level", label: "قبعة تخرج" }], value: o.values?.icon ?? "trophy" })}
    <button class="btn btn-primary btn-sm" type="submit">${icon("plus")}إضافة</button>
  </form>
</section>`,
  );
}

// ---------- مستوى أو دورة ----------

export function programAdminPage(
  view: View,
  program: Program,
  units: UnitWithLessons[],
  o: { done?: string | null; errors?: Record<string, string>; values?: Record<string, string>; hasKey: boolean },
): string {
  const e = o.errors ?? {};
  const word = unitWord(program);
  return adminLayout(
    view,
    program.title,
    "content",
    html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/admin/content">المحتوى</a><span aria-hidden="true">/</span><span aria-current="page">${program.title}</span></nav>
${alertBox(doneMessage(o.done ?? null), "success")}
<header class="page-head page-head-row">
  <h1>${program.title}</h1>
  <a class="btn btn-secondary btn-sm" href="/levels/${program.slug}">${icon("eye")}معاينة في الموقع</a>
</header>
<section class="section" aria-labelledby="units-title">
  <h2 id="units-title">${program.kind === "level" ? "المقاطع" : "الأجزاء"}</h2>
  ${
    units.length
      ? html`<ol class="card admin-list">${units.map(
          (u, i) => html`<li>
      <span class="unit-num">${i + 1}</span>
      <a class="admin-list-main" href="/admin/units/${String(u.id)}"><strong>${u.title}</strong><small>${u.lessons.length} دروس${u.playlist_id ? html` · ${icon("playlist", "icon icon-sm")}مرتبط بقائمة تشغيل` : ""}</small></a>
      ${statusPill(u.status)}
      ${moveButtons(`/admin/units/${u.id}`, i === 0, i === units.length - 1)}
    </li>`,
        )}</ol>`
      : html`<div class="card empty"><p>لا يوجد أي ${word === "المقطع" ? "مقطع" : "جزء"} بعد. أضف الأول من النموذج أدناه.</p></div>`
  }
</section>
<section class="card form-card section">
  <h2>إضافة ${word === "المقطع" ? "مقطع" : "جزء"}</h2>
  ${alertBox(e.form)}
  <form method="post" action="/admin/content/${program.slug}/units" class="form" novalidate>
    ${input({ name: "title", label: "العنوان", value: o.values?.title, required: true, error: e.title, maxlength: 120, hint: "مثال: المقطع 1: الأعداد الطبيعية والأعداد العشرية" })}
    ${input({
      name: "playlist",
      label: "رابط قائمة تشغيل يوتيوب (اختياري)",
      value: o.values?.playlist,
      dir: "ltr",
      error: e.playlist,
      hint: o.hasKey ? "إذا وضعته تُنشأ الدروس تلقائيًا من فيديوهات القائمة، بنفس الترتيب، كمسودات." : "يحتاج مفتاح يوتيوب (لم يُضف بعد). يمكنك الآن إنشاء المقطع ولصق روابط الفيديوهات فيه.",
    })}
    <button class="btn btn-primary btn-sm" type="submit">${icon("plus")}إضافة</button>
  </form>
</section>
${
  program.kind === "course"
    ? html`<section class="card form-card section">
  <h2>اسم الدورة</h2>
  <form method="post" action="/admin/content/${program.slug}/edit" class="form" novalidate>
    ${input({ name: "title", label: "الاسم", value: o.values?.course_title ?? program.title, required: true, error: e.course_title, maxlength: 80 })}
    <button class="btn btn-primary btn-sm" type="submit">حفظ</button>
  </form>
  ${units.length === 0 ? html`<div class="danger-zone">${postButton(`/admin/content/${program.slug}/delete`, html`${icon("trash", "icon icon-sm")}حذف الدورة`, "btn-link btn-danger-link")}</div>` : ""}
</section>`
    : ""
}`,
  );
}

// ---------- المقطع ----------

function lessonRow(l: Lesson, i: number, count: number): Raw {
  const base = `/admin/lessons/${l.id}`;
  return html`<li class="lesson-row">
  <span class="icon-box icon-box-sm${l.status === "draft" ? " icon-box-muted" : ""}">${icon(l.kind)}</span>
  <a class="admin-list-main" href="${base}"><strong>${l.title}</strong><small>${KIND_LABELS[l.kind]}</small></a>
  <span class="lesson-pills">${freePill(l.free)} ${statusPill(l.status)}</span>
  <span class="lesson-actions">
    ${moveButtons(base, i === 0, i === count - 1)}
    ${postButton(`${base}/free`, l.free ? "اجعله مدفوعًا" : "اجعله مجانيًا", "btn btn-secondary btn-xs")}
    ${postButton(`${base}/status`, l.status === "draft" ? "نشر" : "إخفاء", l.status === "draft" ? "btn btn-primary btn-xs" : "btn btn-secondary btn-xs")}
    ${l.quiz_id ? html`<a class="btn btn-secondary btn-xs" href="/admin/quizzes/${String(l.quiz_id)}">${icon("pencil", "icon icon-sm")}الأسئلة</a>` : ""}
  </span>
</li>`;
}

export function unitAdminPage(
  view: View,
  program: Program,
  unit: Unit,
  lessons: Lesson[],
  o: {
    done?: string | null;
    notice?: string | null;
    errors?: Record<string, string>;
    values?: Record<string, string>;
    hasKey: boolean;
    hasFiles: boolean;
  },
): string {
  const e = o.errors ?? {};
  const id = String(unit.id);
  const drafts = lessons.filter((l) => l.status === "draft").length;
  return adminLayout(
    view,
    unit.title,
    "content",
    html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/admin/content">المحتوى</a><span aria-hidden="true">/</span><a href="/admin/content/${program.slug}">${program.title}</a><span aria-hidden="true">/</span><span aria-current="page">${unit.title}</span></nav>
${alertBox(doneMessage(o.done ?? null), "success")}
${alertBox(o.notice ?? null, "info")}
${alertBox(e.form)}
<section class="card hero hero-compact">
  <div class="unit-head">
    <h1>${unit.title}</h1>
    <p>${statusPill(unit.status)} <span class="muted">${lessons.length} دروس${drafts ? html`، منها ${drafts} مسودة` : ""}</span></p>
  </div>
  <div class="actions">
    ${
      unit.status === "draft"
        ? postButton(`/admin/units/${id}/status`, html`${icon("eye")}نشر ${unitWord(program) === "المقطع" ? "المقطع" : "الجزء"}`, "btn btn-primary btn-sm")
        : postButton(`/admin/units/${id}/status`, html`${icon("eyeOff")}إخفاء من الموقع`, "btn btn-secondary btn-sm")
    }
    ${drafts ? postButton(`/admin/units/${id}/publish-all`, html`${icon("check")}نشر كل الدروس (${drafts})`, "btn btn-secondary btn-sm") : ""}
  </div>
  ${unit.status === "draft" ? html`<p class="muted small">المقطع مسودة: لا يظهر هو ولا دروسه في الموقع حتى تنشره، حتى لو كانت الدروس منشورة.</p>` : ""}
</section>

<section class="section" aria-labelledby="lessons-title">
  <h2 id="lessons-title">الدروس</h2>
  ${
    lessons.length
      ? html`<ol class="card admin-list lesson-list">${lessons.map((l, i) => lessonRow(l, i, lessons.length))}</ol>`
      : html`<div class="card empty"><p>لا توجد دروس بعد. استورد قائمة تشغيل، أو الصق روابط الفيديوهات.</p></div>`
  }
</section>

<div class="admin-grid admin-grid-even">
<section class="card form-card" aria-labelledby="pl-title">
  <h2 id="pl-title">${icon("playlist")} قائمة تشغيل يوتيوب</h2>
  ${unit.playlist_id ? html`<p class="muted small">مرتبط بالقائمة <bdi dir="ltr">${unit.playlist_id}</bdi>${unit.playlist_synced_at ? html` · آخر تحديث ${when(unit.playlist_synced_at)}` : ""}</p>` : ""}
  ${!o.hasKey ? alertBox("مفتاح يوتيوب لم يُضف بعد، فلا يمكن قراءة القوائم. يمكنك لصق روابط الفيديوهات في النموذج المجاور.", "info") : ""}
  <form method="post" action="/admin/units/${id}/playlist" class="form" novalidate>
    ${input({ name: "playlist", label: "رابط القائمة", value: o.values?.playlist ?? (unit.playlist_id ? `https://www.youtube.com/playlist?list=${unit.playlist_id}` : ""), dir: "ltr", error: e.playlist })}
    <button class="btn btn-primary btn-sm" type="submit"${o.hasKey ? "" : html` disabled`}>${icon("refresh")}${unit.playlist_id ? "تحديث من يوتيوب" : "استيراد الفيديوهات"}</button>
  </form>
  <p class="muted small">الفيديوهات الجديدة تُضاف في آخر المقطع كمسودات مدفوعة. الموجودة لا تتكرر ولا تتغير عناوينها.</p>
</section>

<section class="card form-card" aria-labelledby="pdf-title">
  <h2 id="pdf-title">${icon("pdf")} رفع ملف PDF</h2>
  ${alertBox(e.pdf)}
  ${
    o.hasFiles
      ? html`<form method="post" action="/admin/units/${id}/pdf" enctype="multipart/form-data" class="form" novalidate>
    <div class="field"><label for="f-file">الملف (حتى 20 ميغابايت)</label><input id="f-file" class="input input-file" type="file" name="file" accept="application/pdf,.pdf" required></div>
    ${input({ name: "title", id: "f-pdf-title", label: "العنوان (اختياري)", value: o.values?.pdf_title, maxlength: 200, hint: "إن تركته فارغًا يُستعمل اسم الملف." })}
    ${select({ name: "file_mode", label: "طريقة الإتاحة", options: FILE_MODE_OPTIONS, value: o.values?.file_mode ?? "both" })}
    <button class="btn btn-primary btn-sm" type="submit">${icon("upload")}رفع</button>
  </form>`
      : alertBox("مخزن الملفات (R2) غير مفعّل بعد في حساب Cloudflare. بعد تفعيله يظهر هنا نموذج الرفع.", "info")
  }
</section>

<section class="card form-card" aria-labelledby="quiz-title">
  <h2 id="quiz-title">${icon("quiz")} إضافة اختبار أو فرض</h2>
  ${alertBox(e.quiz)}
  <form method="post" action="/admin/units/${id}/quiz" class="form" novalidate>
    ${input({ name: "title", id: "f-quiz-title", label: "العنوان", value: o.values?.quiz_title, required: true, maxlength: 200, hint: "مثال: فرض المقطع 1، أو تمارين الكسور. بعدها تضيف الأسئلة." })}
    <button class="btn btn-primary btn-sm" type="submit">${icon("plus")}إنشاء</button>
  </form>
</section>

<section class="card form-card" aria-labelledby="paste-title">
  <h2 id="paste-title">${icon("video")} لصق روابط فيديو</h2>
  <form method="post" action="/admin/units/${id}/videos" class="form" novalidate>
    ${textarea({ name: "links", label: "رابط واحد في كل سطر", value: o.values?.links, dir: "ltr", rows: 4, error: e.links, hint: "حتى 40 رابطًا في المرة. العنوان يُؤخذ من يوتيوب، ويمكنك تعديله بعدها." })}
    <button class="btn btn-primary btn-sm" type="submit">${icon("plus")}إضافة</button>
  </form>
</section>
</div>

<section class="card form-card section" aria-labelledby="edit-title">
  <h2 id="edit-title">العنوان</h2>
  <form method="post" action="/admin/units/${id}/edit" class="form" novalidate>
    ${input({ name: "title", label: "العنوان", value: o.values?.title ?? unit.title, required: true, error: e.title, maxlength: 120 })}
    <button class="btn btn-primary btn-sm" type="submit">حفظ</button>
  </form>
  <details class="danger-zone">
    <summary class="btn-link btn-danger-link">${icon("trash", "icon icon-sm")}حذف ${unitWord(program) === "المقطع" ? "المقطع" : "الجزء"}</summary>
    <form method="post" action="/admin/units/${id}/delete" class="form">
      <p class="muted small">يُحذف ${unitWord(program) === "المقطع" ? "المقطع" : "الجزء"} وكل دروسه (${lessons.length}) نهائيًا. الفيديوهات تبقى في قناتك على يوتيوب.</p>
      <label class="check"><input type="checkbox" name="confirm" value="1" required> أؤكد الحذف</label>
      <button class="btn btn-danger btn-sm" type="submit">حذف نهائي</button>
    </form>
  </details>
</section>`,
  );
}

// ---------- الدرس ----------

export function lessonAdminPage(
  view: View,
  program: Program,
  unit: Unit,
  lesson: Lesson,
  units: Unit[],
  o: { done?: string | null; errors?: Record<string, string>; values?: Record<string, string> } = {},
): string {
  const e = o.errors ?? {};
  const v = o.values ?? {};
  const id = String(lesson.id);
  return adminLayout(
    view,
    lesson.title,
    "content",
    html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/admin/content">المحتوى</a><span aria-hidden="true">/</span><a href="/admin/content/${program.slug}">${program.title}</a><span aria-hidden="true">/</span><a href="/admin/units/${String(unit.id)}">${unit.title}</a></nav>
${alertBox(doneMessage(o.done ?? null), "success")}
<header class="page-head page-head-row">
  <div><h1>${lesson.title}</h1><p>${freePill(lesson.free)} ${statusPill(lesson.status)} <span class="item-kind">${KIND_LABELS[lesson.kind]}</span></p></div>
  <a class="btn btn-secondary btn-sm" href="/lessons/${id}">${icon("eye")}معاينة</a>
</header>
${
  lesson.kind === "video" && lesson.youtube_id
    ? html`<p class="muted small">الفيديو على يوتيوب: <a href="https://youtu.be/${lesson.youtube_id}" target="_blank" rel="noopener" dir="ltr">youtu.be/${lesson.youtube_id}</a></p>`
    : lesson.kind === "pdf"
      ? html`<p class="muted small">الملف: <bdi>${lesson.file_name ?? ""}</bdi>${lesson.file_size ? html` (<bdi dir="ltr">${formatSize(lesson.file_size)}</bdi>)` : ""}</p>`
      : ""
}
<section class="card form-card">
  <form method="post" action="/admin/lessons/${id}/edit" class="form" novalidate>
    ${input({ name: "title", label: "العنوان", value: v.title ?? lesson.title, required: true, error: e.title, maxlength: 200 })}
    ${textarea({ name: "description", label: "وصف قصير (اختياري)", value: v.description ?? lesson.description ?? "", rows: 3, maxlength: 1000 })}
    ${select({ name: "free", label: "الإتاحة", options: [{ value: "0", label: "مدفوع: للمشتركين فقط" }, { value: "1", label: "مجاني: للجميع" }], value: v.free ?? String(lesson.free) })}
    ${select({ name: "status", label: "الحالة", options: [{ value: "draft", label: "مسودة: لا يظهر في الموقع" }, { value: "published", label: "منشور" }], value: v.status ?? lesson.status })}
    ${lesson.kind === "pdf" ? select({ name: "file_mode", label: "طريقة الإتاحة", options: FILE_MODE_OPTIONS, value: v.file_mode ?? lesson.file_mode ?? "both" }) : ""}
    ${select({ name: "unit_id", label: unitWord(program) === "المقطع" ? "المقطع" : "الجزء", options: units.map((u) => ({ value: String(u.id), label: u.title })), value: v.unit_id ?? String(lesson.unit_id), error: e.unit_id })}
    <button class="btn btn-primary btn-sm" type="submit">حفظ</button>
  </form>
  <details class="danger-zone">
    <summary class="btn-link btn-danger-link">${icon("trash", "icon icon-sm")}حذف الدرس</summary>
    <form method="post" action="/admin/lessons/${id}/delete" class="form">
      <label class="check"><input type="checkbox" name="confirm" value="1" required> أؤكد حذف هذا الدرس</label>
      <button class="btn btn-danger btn-sm" type="submit">حذف نهائي</button>
    </form>
  </details>
</section>`,
  );
}
