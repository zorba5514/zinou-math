// صفحات الموقع العامة (للزوار)، تُبنى في الخادم وتُرسل جاهزة إلى المتصفح.
// التصميم حسب مهارة zinou-design: خط Tajawal، بطاقات مستديرة بظلال ناعمة،
// قائمة جانبية داكنة، والأصفر للعناصر المهمة فقط.

import { html, type Raw } from "./html.ts";
import { icon, type IconName } from "./icons.ts";
import { describe, formula, intercept, linePath, toY, SIZE, UNIT } from "../public/graph.js";
import {
  PROGRAMS,
  KIND_LABELS,
  countItems,
  type Item,
  type Program,
  type Unit,
} from "./catalog.ts";

export const SITE_NAME = "الأستاذ زين الدين للرياضيات";
export const SLOGAN = "الرياضيات كما يجب أن تكون";

type Nav = "home" | "levels" | "subscribe" | null;

function navItem(href: string, label: string, ic: IconName, key: Nav, current: Nav): Raw {
  return key === current
    ? html`<a class="nav-item" href="${href}" aria-current="page">${icon(ic)}<span>${label}</span></a>`
    : html`<a class="nav-item" href="${href}">${icon(ic)}<span>${label}</span></a>`;
}

/** الخط المتعرج أسفل الشعار، فاصل زخرفي رفيع. */
const ZIGZAG = html`<svg class="zigzag" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9h14l12-6 14 7 14-7 14 6h52" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;

export function layout(opts: {
  title: string;
  env: string;
  current: Nav;
  body: Raw;
  description?: string;
  scripts?: boolean;
}): string {
  const fullTitle = opts.title === SITE_NAME ? SITE_NAME : `${opts.title} | ${SITE_NAME}`;
  const staging = opts.env !== "production";
  const description =
    opts.description ?? `${SITE_NAME}: ${SLOGAN}. دروس رياضيات من الأولى متوسط إلى الأولى ثانوي.`;
  return html`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${staging ? html`<meta name="robots" content="noindex">` : ""}
<meta name="theme-color" content="#16181D">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preload" href="/fonts/tajawal-ar-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/tajawal-ar-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
${opts.scripts ? html`<script type="module" src="/app.js"></script>` : ""}
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
${staging ? html`<p class="staging">نسخة الاختبار: المحتوى المعروض تجريبي.</p>` : ""}
<div class="shell">
  <aside id="drawer" class="drawer" popover aria-label="القائمة">
    <button class="drawer-close" type="button" popovertarget="drawer" popovertargetaction="hide" aria-label="إغلاق القائمة">${icon("x")}</button>
    <a class="drawer-brand" href="/">
      <img src="/brand/logo.svg" alt="" width="72" height="64">
      <strong>${SITE_NAME}</strong>
      <span>${SLOGAN}</span>
    </a>
    <p class="drawer-label">القائمة الرئيسية</p>
    <nav class="drawer-nav" aria-label="القائمة الرئيسية">
      ${navItem("/", "الرئيسية", "home", "home", opts.current)}
      ${navItem("/levels", "الدروس", "book", "levels", opts.current)}
      ${navItem("/subscribe", "الاشتراك", "card", "subscribe", opts.current)}
    </nav>
    <a class="drawer-card" href="/subscribe">
      <span class="drawer-card-icon">${icon("chat")}</span>
      <span><strong>اشترك مع الأستاذ</strong><small>يفعّل حساب العائلة بعد الدفع</small></span>
    </a>
  </aside>
  <div class="main-col">
    <header class="topbar">
      <button class="menu-btn" type="button" popovertarget="drawer" aria-label="فتح القائمة">${icon("menu")}</button>
      <a class="topbar-brand" href="/"><img src="/brand/logo.svg" alt="" width="40" height="40"><span>${SITE_NAME}</span></a>
    </header>
    <main id="main" class="content">
${opts.body}
    </main>
    <footer class="site-footer">
      <p>${SITE_NAME}. ${SLOGAN}.</p>
    </footer>
  </div>
</div>
</body>
</html>`.value;
}

function programCard(program: Program): Raw {
  const { free, total } = countItems(program);
  const parts = program.kind === "level" ? "مقاطع" : "أجزاء";
  return html`<li>
  <a class="card program-card" href="/levels/${program.slug}">
    <span class="icon-box${program.kind === "course" ? " icon-box-ink" : ""}">${icon(program.icon)}</span>
    <span class="program-title">${program.title}</span>
    <span class="program-meta">${program.units.length} ${parts} · ${total} عنصرًا</span>
    ${free > 0 ? html`<span class="pill pill-success">${icon("gift", "icon icon-sm")}دروس مجانية</span>` : ""}
  </a>
</li>`;
}

function programGrids(): Raw {
  const levels = PROGRAMS.filter((p) => p.kind === "level");
  const courses = PROGRAMS.filter((p) => p.kind === "course");
  return html`<section class="section" aria-labelledby="levels-title">
  <h2 id="levels-title">المستويات الدراسية</h2>
  <ul class="card-grid">${levels.map(programCard)}</ul>
</section>
<section class="section" aria-labelledby="courses-title">
  <h2 id="courses-title">دورات خاصة</h2>
  <ul class="card-grid">${courses.map(programCard)}</ul>
</section>`;
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

export function homePage(env: string): string {
  return layout({
    title: SITE_NAME,
    env,
    current: "home",
    scripts: true,
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
${programGrids()}
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

export function levelsPage(env: string): string {
  return layout({
    title: "الدروس",
    env,
    current: "levels",
    body: html`<header class="page-head">
  <h1>الدروس</h1>
  <p class="muted">اختر مستوى أو دورة. المحتوى المجاني مفتوح للجميع، والمدفوع يظهر بقفل.</p>
</header>
${programGrids()}`,
  });
}

function itemRow(item: Item): Raw {
  const kind = KIND_LABELS[item.kind];
  if (item.free) {
    return html`<li>
  <a class="item" href="/items/${item.id}">
    <span class="icon-box icon-box-sm">${icon(item.kind)}</span>
    <span class="item-body"><span class="item-title">${item.title}</span><span class="item-kind">${kind}</span></span>
    <span class="pill pill-success">مجاني</span>
  </a>
</li>`;
  }
  return html`<li>
  <a class="item item-locked" href="/subscribe?item=${item.id}" aria-label="${item.title}، ${kind}، مقفل: يتطلب اشتراكًا">
    <span class="icon-box icon-box-sm icon-box-muted">${icon(item.kind)}</span>
    <span class="item-body"><span class="item-title">${item.title}</span><span class="item-kind">${kind}</span></span>
    <span class="pill pill-muted">${icon("lock", "icon icon-sm")}مقفل</span>
  </a>
</li>`;
}

function unitBlock(unit: Unit, index: number): Raw {
  const free = unit.items.filter((i) => i.free).length;
  const summary = html`<summary>
    <span class="unit-num">${index + 1}</span>
    <span class="unit-text"><span class="unit-title" id="${unit.id}">${unit.title}</span><span class="item-kind">${unit.items.length} عناصر${free ? html`، منها ${free} مجانًا` : ""}</span></span>
    ${icon("chevron", "icon unit-chevron")}
  </summary>
  <ul class="items">${unit.items.map(itemRow)}</ul>`;
  return index === 0
    ? html`<details class="card unit" open>${summary}</details>`
    : html`<details class="card unit">${summary}</details>`;
}

export function programPage(env: string, program: Program): string {
  const { free, total } = countItems(program);
  const parts = program.kind === "level" ? "مقاطع" : "أجزاء";
  return layout({
    title: program.title,
    env,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a><span aria-hidden="true">/</span><span aria-current="page">${program.title}</span></nav>
<section class="card hero hero-compact">
  <span class="icon-box icon-box-lg${program.kind === "course" ? " icon-box-ink" : ""}">${icon(program.icon)}</span>
  <h1>${program.title}</h1>
  <p class="muted">اضغط على ${program.kind === "level" ? "المقطع" : "الجزء"} لعرض دروسه.</p>
</section>
<ul class="stats">
  <li class="card stat"><span class="icon-box">${icon("layers")}</span><strong>${program.units.length}</strong><span class="muted">${parts}</span></li>
  <li class="card stat"><span class="icon-box icon-box-soft">${icon("book")}</span><strong>${total}</strong><span class="muted">عنصرًا</span></li>
  <li class="card stat"><span class="icon-box icon-box-success">${icon("gift")}</span><strong>${free}</strong><span class="muted">مجانًا</span></li>
</ul>
<div class="units">${program.units.map(unitBlock)}</div>`,
  });
}

export function itemPage(env: string, program: Program, unit: Unit, item: Item): string {
  return layout({
    title: item.title,
    env,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a><span aria-hidden="true">/</span><a href="/levels/${program.slug}">${program.title}</a><span aria-hidden="true">/</span><span aria-current="page">${unit.title}</span></nav>
<section class="card hero hero-compact">
  <span class="icon-box icon-box-lg">${icon(item.kind)}</span>
  <h1>${item.title}</h1>
  <p><span class="pill pill-success">مجاني</span> <span class="item-kind">${KIND_LABELS[item.kind]}</span></p>
</section>
<div class="notice">هذا عنصر تجريبي. الفيديو والملفات الحقيقية تُضاف من لوحة التحكم في المرحلة 4.</div>
<p><a class="btn btn-secondary" href="/levels/${program.slug}">العودة إلى ${program.title}</a></p>`,
  });
}

export function subscribePage(env: string, locked?: { program: Program; item: Item }): string {
  return layout({
    title: "الاشتراك",
    env,
    current: "subscribe",
    body: html`<header class="page-head">
  <h1>الاشتراك</h1>
  <p class="muted">باقات تفتح كل دروس المستوى، يفعّلها الأستاذ بعد الدفع.</p>
</header>
${
  locked
    ? html`<div class="notice notice-lock">${icon("lock")}<span><strong>${locked.item.title}</strong> من ${locked.program.title} ضمن المحتوى المدفوع. يُفتح بعد الاشتراك.</span></div>`
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

export function notFoundPage(env: string): string {
  return layout({
    title: "الصفحة غير موجودة",
    env,
    current: null,
    body: html`<section class="card hero hero-compact">
  <h1>الصفحة غير موجودة</h1>
  <p class="muted">الرابط غير صحيح أو أن الصفحة نُقلت.</p>
  <div class="actions"><a class="btn btn-primary" href="/">العودة إلى الرئيسية ${icon("arrowLeft")}</a></div>
</section>`,
  });
}
