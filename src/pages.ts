// صفحات الموقع العامة (للزوار)، تُبنى في الخادم وتُرسل جاهزة إلى المتصفح.
// التصميم حسب مهارة zinou-design: خط Tajawal، بطاقات مستديرة بظلال ناعمة،
// قائمة جانبية داكنة، والأصفر للعناصر المهمة فقط.

import { html, type Raw } from "./html.ts";
import { layout, ZIGZAG, SITE_NAME, SLOGAN, type View } from "./ui.ts";
import { icon, type IconName } from "./icons.ts";
import { describe, formula, intercept, linePath, toY, SIZE, UNIT } from "../public/graph.js";
import {
  KIND_LABELS,
  canOpen,
  unitWord,
  type Lesson,
  type LessonContext,
  type Program,
  type ProgramSummary,
  type UnitWithLessons,
} from "./content.ts";

export { SITE_NAME, SLOGAN } from "./ui.ts";

function programCard(program: ProgramSummary): Raw {
  const meta = program.units
    ? html`${program.units} ${unitWord(program, true)} · ${program.lessons} درسًا`
    : html`الدروس قيد الإعداد`;
  return html`<li>
  <a class="card program-card" href="/levels/${program.slug}">
    <span class="icon-box${program.kind === "course" ? " icon-box-ink" : ""}">${icon(program.icon)}</span>
    <span class="program-title">${program.title}</span>
    <span class="program-meta">${meta}</span>
    ${program.free > 0 ? html`<span class="pill pill-success">${icon("gift", "icon icon-sm")}دروس مجانية</span>` : ""}
  </a>
</li>`;
}

function programGrids(programs: ProgramSummary[]): Raw {
  const levels = programs.filter((p) => p.kind === "level");
  const courses = programs.filter((p) => p.kind === "course");
  return html`<section class="section" aria-labelledby="levels-title">
  <h2 id="levels-title">المستويات الدراسية</h2>
  <ul class="card-grid">${levels.map(programCard)}</ul>
</section>
${
  courses.length
    ? html`<section class="section" aria-labelledby="courses-title">
  <h2 id="courses-title">دورات خاصة</h2>
  <ul class="card-grid">${courses.map(programCard)}</ul>
</section>`
    : ""
}`;
}

const START_A = 1;
const START_B = 2;

function graphCard(): Raw {
  const f = formula(START_A, START_B);
  const mid = SIZE / 2;
  return html`<section class="card graph-card" aria-labelledby="graph-title" data-graph>
  <div class="graph-head">
    <span class="icon-box">${icon("layers")}</span>
    <div>
      <h2 id="graph-title">جرّب بنفسك</h2>
      <p class="muted">حرّك المؤشرين وشاهد كيف يتغير المستقيم.</p>
    </div>
  </div>
  <div class="graph-body">
    <svg class="graph-svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="رسم المستقيم ${f}">
      <defs>
        <pattern id="squares" width="${UNIT}" height="${UNIT}" patternUnits="userSpaceOnUse"><path d="M${UNIT} 0H0V${UNIT}" class="grid-line"/></pattern>
        <clipPath id="frame"><rect width="${SIZE}" height="${SIZE}" rx="16"/></clipPath>
      </defs>
      <rect width="${SIZE}" height="${SIZE}" rx="16" class="graph-bg"/>
      <rect width="${SIZE}" height="${SIZE}" rx="16" fill="url(#squares)"/>
      <path class="axis" d="M0 ${mid}H${SIZE}M${mid} 0V${SIZE}"/>
      <text class="axis-label" x="${SIZE - 14}" y="${mid - 8}">x</text>
      <text class="axis-label" x="${mid + 8}" y="18">y</text>
      <g clip-path="url(#frame)"><path class="fx" data-line pathLength="1" d="${linePath(START_A, START_B)}"/></g>
      <circle class="pt" data-point cx="${mid}" cy="${toY(START_B)}" r="7"/>
    </svg>
    <div class="graph-side">
      <p class="formula" dir="ltr" data-formula>${f}</p>
      <p class="graph-note" aria-live="polite"><span data-note>${describe(START_A)}</span><br>يقطع محور التراتيب في النقطة <bdi dir="ltr" data-intercept>${intercept(START_B)}</bdi></p>
      <div class="controls" data-controls>
        <label class="control"><span class="control-name">الميل <bdi dir="ltr"><b>a</b> = <output data-out-a>${START_A}</output></bdi></span><input type="range" dir="ltr" min="-3" max="3" step="0.5" value="${START_A}" data-a disabled></label>
        <label class="control"><span class="control-name">الترتيبة عند المبدأ <bdi dir="ltr"><b>b</b> = <output data-out-b>${START_B}</output></bdi></span><input type="range" dir="ltr" min="-6" max="6" step="1" value="${START_B}" data-b disabled></label>
      </div>
    </div>
  </div>
</section>`;
}

function steps(items: [string, string, IconName][]): Raw {
  return html`<ol class="steps">${items.map(
    ([title, text, ic], i) => html`<li class="card step">
  <span class="step-num">${i + 1}</span>
  <span class="icon-box icon-box-soft">${icon(ic)}</span>
  <strong>${title}</strong>
  <span class="muted">${text}</span>
</li>`,
  )}</ol>`;
}

export function homePage(view: View, programs: ProgramSummary[]): string {
  return layout({
    title: SITE_NAME,
    view,
    current: "home",
    scripts: ["/app.js"],
    body: html`<section class="card hero">
  <span class="badge-pill"><span class="dot"></span>دروس الرياضيات من 1 متوسط إلى 1 ثانوي</span>
  <h1>${SITE_NAME}</h1>
  <p class="hero-sub">${SLOGAN}</p>
  <p class="muted hero-text">دروس مسجلة، وملخصات PDF، واختبارات تُصحَّح آليًا، ونتائج يتابعها الولي.</p>
  <div class="actions">
    <a class="btn btn-primary" href="/levels">اكتشف الدروس ${icon("arrowLeft")}</a>
    <a class="btn btn-secondary" href="/subscribe">${icon("card")}طريقة الاشتراك</a>
  </div>
  <span class="hero-zigzag">${ZIGZAG}</span>
</section>
${graphCard()}
${programGrids(programs)}
<section class="section" aria-labelledby="how-title">
  <h2 id="how-title">كيف تعمل المنصة</h2>
  ${steps([
    ["اختر المستوى", "تصفّح الدروس المجانية دون حساب.", "book"],
    ["اشترك مع الأستاذ", "يفعّل الأستاذ حساب العائلة بعد الدفع.", "card"],
    ["تعلّم وتابع", "دروس واختبارات، ونتائج يراها الولي.", "check"],
  ])}
</section>`,
  });
}

export function levelsPage(view: View, programs: ProgramSummary[]): string {
  return layout({
    title: "الدروس",
    view,
    current: "levels",
    body: html`<header class="page-head">
  <h1>الدروس</h1>
  <p class="muted">اختر مستوى أو دورة. المحتوى المجاني مفتوح للجميع، والمدفوع يظهر بقفل.</p>
</header>
${programGrids(programs)}`,
  });
}

function lessonRow(view: View, lesson: Lesson): Raw {
  const kind = KIND_LABELS[lesson.kind];
  const draft = lesson.status === "draft" ? html` <span class="pill pill-warning">مسودة</span>` : "";
  if (canOpen(view.viewer, lesson)) {
    return html`<li>
  <a class="item" href="/lessons/${String(lesson.id)}">
    <span class="icon-box icon-box-sm">${icon(lesson.kind)}</span>
    <span class="item-body"><span class="item-title">${lesson.title}</span><span class="item-kind">${kind}</span></span>
    ${lesson.free ? html`<span class="pill pill-success">مجاني</span>` : html`<span class="pill pill-muted">مدفوع</span>`}${draft}
  </a>
</li>`;
  }
  return html`<li>
  <a class="item item-locked" href="/subscribe?lesson=${String(lesson.id)}" aria-label="${lesson.title}، ${kind}، مقفل: يتطلب اشتراكًا">
    <span class="icon-box icon-box-sm icon-box-muted">${icon(lesson.kind)}</span>
    <span class="item-body"><span class="item-title">${lesson.title}</span><span class="item-kind">${kind}</span></span>
    <span class="pill pill-muted">${icon("lock", "icon icon-sm")}مقفل</span>
  </a>
</li>`;
}

function unitBlock(view: View, unit: UnitWithLessons, index: number): Raw {
  const free = unit.lessons.filter((l) => l.free).length;
  const summary = html`<summary>
    <span class="unit-num">${index + 1}</span>
    <span class="unit-text"><span class="unit-title" id="unit-${String(unit.id)}">${unit.title}${unit.status === "draft" ? html` <span class="pill pill-warning">مسودة</span>` : ""}</span><span class="item-kind">${unit.lessons.length ? html`${unit.lessons.length} دروس${free ? html`، منها ${free} مجانًا` : ""}` : "الدروس قيد الإعداد"}</span></span>
    ${icon("chevron", "icon unit-chevron")}
  </summary>
  ${unit.lessons.length ? html`<ul class="items">${unit.lessons.map((l) => lessonRow(view, l))}</ul>` : ""}`;
  return index === 0
    ? html`<details class="card unit" open>${summary}</details>`
    : html`<details class="card unit">${summary}</details>`;
}

export function programPage(view: View, program: Program, units: UnitWithLessons[]): string {
  const total = units.reduce((n, u) => n + u.lessons.length, 0);
  const free = units.reduce((n, u) => n + u.lessons.filter((l) => l.free).length, 0);
  return layout({
    title: program.title,
    view,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a><span aria-hidden="true">/</span><span aria-current="page">${program.title}</span></nav>
<section class="card hero hero-compact">
  <span class="icon-box icon-box-lg${program.kind === "course" ? " icon-box-ink" : ""}">${icon(program.icon)}</span>
  <h1>${program.title}</h1>
  <p class="muted">${units.length ? html`اضغط على ${unitWord(program)} لعرض دروسه.` : "الدروس قيد الإعداد، وتظهر هنا قريبًا."}</p>
</section>
${
  units.length
    ? html`<ul class="stats">
  <li class="card stat"><span class="icon-box">${icon("layers")}</span><strong>${units.length}</strong><span class="muted">${unitWord(program, true)}</span></li>
  <li class="card stat"><span class="icon-box icon-box-soft">${icon("book")}</span><strong>${total}</strong><span class="muted">درسًا</span></li>
  <li class="card stat"><span class="icon-box icon-box-success">${icon("gift")}</span><strong>${free}</strong><span class="muted">مجانًا</span></li>
</ul>
<div class="units">${units.map((u, i) => unitBlock(view, u, i))}</div>`
    : ""
}`,
  });
}

function lessonBody(c: LessonContext): Raw {
  const { lesson } = c;
  if (lesson.kind === "video" && lesson.youtube_id) {
    return html`<div class="video-frame">
  <iframe src="https://www.youtube-nocookie.com/embed/${lesson.youtube_id}?rel=0&amp;modestbranding=1" title="${lesson.title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>
</div>`;
  }
  const mode = lesson.file_mode ?? "both";
  const id = String(lesson.id);
  return html`<section class="card file-card">
  <span class="icon-box icon-box-lg">${icon("pdf")}</span>
  <div class="file-main"><strong>${lesson.file_name ?? lesson.title}</strong>${lesson.file_size ? html`<small dir="ltr">${(lesson.file_size / 1024 / 1024).toFixed(1)} MB</small>` : ""}</div>
  <div class="actions">
    ${mode !== "download" ? html`<a class="btn btn-primary" href="/files/${id}" target="_blank" rel="noopener">${icon("book")}عرض الملف</a>` : ""}
    ${mode !== "view" ? html`<a class="btn btn-secondary" href="/files/${id}?download=1">${icon("pdf")}تحميل</a>` : ""}
  </div>
</section>`;
}

export function lessonPage(view: View, c: LessonContext, next: Lesson | null): string {
  const { program, unit, lesson } = c;
  const draft = lesson.status === "draft" || unit.status === "draft";
  return layout({
    title: lesson.title,
    view,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a><span aria-hidden="true">/</span><a href="/levels/${program.slug}">${program.title}</a><span aria-hidden="true">/</span><span aria-current="page">${unit.title}</span></nav>
${draft ? html`<div class="notice">${icon("info")}<span>معاينة: هذا الدرس مسودة، لا يراه أحد غيرك.</span></div>` : ""}
<header class="page-head">
  <h1>${lesson.title}</h1>
  <p>${lesson.free ? html`<span class="pill pill-success">مجاني</span>` : html`<span class="pill pill-muted">مدفوع</span>`} <span class="item-kind">${KIND_LABELS[lesson.kind]}</span></p>
</header>
${lessonBody(c)}
${lesson.description ? html`<p class="lesson-text">${lesson.description}</p>` : ""}
<div class="actions lesson-nav">
  ${next ? html`<a class="btn btn-primary" href="/lessons/${String(next.id)}">الدرس التالي ${icon("arrowLeft")}</a>` : ""}
  <a class="btn btn-secondary" href="/levels/${program.slug}#unit-${String(unit.id)}">العودة إلى ${program.title}</a>
</div>`,
  });
}

export function subscribePage(view: View, locked?: { program: Program; lesson: Lesson }): string {
  return layout({
    title: "الاشتراك",
    view,
    current: "subscribe",
    body: html`<header class="page-head">
  <h1>الاشتراك</h1>
  <p class="muted">باقات تفتح كل دروس المستوى، يفعّلها الأستاذ بعد الدفع.</p>
</header>
${
  locked
    ? html`<div class="notice notice-lock">${icon("lock")}<span><strong>${locked.lesson.title}</strong> من ${locked.program.title} ضمن المحتوى المدفوع. يُفتح بعد الاشتراك.</span></div>`
    : ""
}
<section class="section" aria-labelledby="plans-title">
  <h2 id="plans-title">الباقات</h2>
  <ul class="card-grid">
    <li class="card plan"><span class="icon-box icon-box-soft">${icon("book")}</span><strong>باقة الفصل</strong><span class="muted">كل دروس المستوى لفصل دراسي كامل.</span></li>
    <li class="card plan plan-main"><span class="icon-box">${icon("level")}</span><strong>الباقة السنوية</strong><span class="muted">كل دروس المستوى للسنة الدراسية.</span></li>
    <li class="card plan"><span class="icon-box icon-box-ink">${icon("trophy")}</span><strong>الدورات الخاصة</strong><span class="muted">كل دورة مفتوحة سنة كاملة من تاريخ التفعيل.</span></li>
  </ul>
</section>
<section class="section" aria-labelledby="steps-title">
  <h2 id="steps-title">طريقة الاشتراك</h2>
  ${steps([
    ["تواصل مع الأستاذ", "لاختيار الباقة المناسبة.", "chat"],
    ["ادفع", "حسب معلومات الدفع التي يرسلها الأستاذ.", "card"],
    ["استلم حسابك", "تدخل برقم هاتف الولي.", "user"],
  ])}
</section>
<div class="notice">الأسعار ومعلومات الدفع ورقم واتساب تُضاف من لوحة التحكم في المرحلة 5.</div>`,
  });
}

export function notFoundPage(view: View): string {
  return layout({
    title: "الصفحة غير موجودة",
    view,
    current: null,
    body: html`<section class="card hero hero-compact">
  <h1>الصفحة غير موجودة</h1>
  <p class="muted">الرابط غير صحيح أو أن الصفحة نُقلت.</p>
  <div class="actions"><a class="btn btn-primary" href="/">العودة إلى الرئيسية ${icon("arrowLeft")}</a></div>
</section>`,
  });
}
