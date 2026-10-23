// صفحات الموقع العامة (للزوار)، تُبنى في الخادم وتُرسل جاهزة إلى المتصفح.
// الهوية: «دفتر المربعات»، صفحة بمربعات زرقاء خفيفة وهامش أحمر، والأصفر قلم تحديد.

import { html, type Raw } from "./html.ts";
import { describe, formula, intercept, linePath, toY, SIZE, UNIT } from "../public/graph.js";
import {
  PROGRAMS,
  KIND_LABELS,
  countItems,
  type Item,
  type ItemKind,
  type Program,
  type Unit,
} from "./catalog.ts";

export const SITE_NAME = "الأستاذ زين الدين للرياضيات";
export const SLOGAN = "الرياضيات كما يجب أن تكون";

type Nav = "home" | "levels" | "subscribe" | null;

const ICONS: Record<ItemKind | "lock", Raw> = {
  video: html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>`,
  pdf: html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z M14 3v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  quiz: html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lock: html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="10" width="14" height="10" rx="2"/></svg>`,
};

function navLink(href: string, label: string, key: Nav, current: Nav): Raw {
  return key === current
    ? html`<a href="${href}" aria-current="page">${label}</a>`
    : html`<a href="${href}">${label}</a>`;
}

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
<meta name="theme-color" content="#181818">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preload" href="/fonts/plex-ar-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
${opts.scripts ? html`<script type="module" src="/app.js"></script>` : ""}
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
${staging ? html`<p class="staging">نسخة الاختبار: المحتوى المعروض تجريبي.</p>` : ""}
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">
      <img src="/brand/logo.svg" alt="" width="40" height="36">
      <span>${SITE_NAME}</span>
    </a>
    <nav aria-label="القائمة الرئيسية">
      ${navLink("/", "الرئيسية", "home", opts.current)}
      ${navLink("/levels", "الدروس", "levels", opts.current)}
      ${navLink("/subscribe", "الاشتراك", "subscribe", opts.current)}
    </nav>
  </div>
</header>
<main id="main" class="paper">
<div class="wrap">
${opts.body}
</div>
</main>
<footer class="site-footer">
  <div class="wrap footer-row">
    <img src="/brand/logo.svg" alt="" width="36" height="32">
    <p><strong>${SITE_NAME}</strong><br>${SLOGAN}</p>
  </div>
</footer>
</body>
</html>`.value;
}

function hexMark(program: Program, size: "sm" | "lg" = "sm"): Raw {
  return html`<span class="hex hex-${size}${program.kind === "course" ? " hex-course" : ""}" aria-hidden="true"><span class="hex-mark">${program.mark}</span><span class="hex-stage">${program.stage}</span></span>`;
}

function programTile(program: Program): Raw {
  const { free } = countItems(program);
  const parts = program.kind === "level" ? "مقاطع" : "أجزاء";
  const freeBadge = free > 0 ? html` <span class="badge badge-free">فيه دروس مجانية</span>` : "";
  return html`<li>
  <a class="tile${program.kind === "course" ? " tile-course" : ""}" href="/levels/${program.slug}">
    ${hexMark(program)}
    <span class="tile-text">
      <span class="tile-title">${program.title}</span>
      <span class="tile-meta">${program.units.length} ${parts}${freeBadge}</span>
    </span>
  </a>
</li>`;
}

function programGrids(): Raw {
  const levels = PROGRAMS.filter((p) => p.kind === "level");
  const courses = PROGRAMS.filter((p) => p.kind === "course");
  return html`<section aria-labelledby="levels-title">
  <h2 id="levels-title"><span class="marker">المستويات الدراسية</span></h2>
  <ul class="tiles">${levels.map(programTile)}</ul>
</section>
<section aria-labelledby="courses-title">
  <h2 id="courses-title"><span class="marker">دورات خاصة</span></h2>
  <ul class="tiles">${courses.map(programTile)}</ul>
</section>`;
}

const START_A = 1;
const START_B = 2;

function graphFigure(): Raw {
  const f = formula(START_A, START_B);
  const mid = SIZE / 2;
  return html`<figure class="graph" data-graph>
  <svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="رسم المستقيم ${f}">
    <defs>
      <pattern id="squares" width="${UNIT}" height="${UNIT}" patternUnits="userSpaceOnUse"><path d="M${UNIT} 0H0V${UNIT}" class="grid-line"/></pattern>
      <clipPath id="frame"><rect width="${SIZE}" height="${SIZE}"/></clipPath>
    </defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#squares)"/>
    <path class="axis" d="M0 ${mid}H${SIZE}M${mid} 0V${SIZE}"/>
    <text class="axis-label" x="${SIZE - 12}" y="${mid - 8}">x</text>
    <text class="axis-label" x="${mid + 8}" y="16">y</text>
    <g clip-path="url(#frame)"><path class="fx" data-line pathLength="1" d="${linePath(START_A, START_B)}"/></g>
    <circle class="pt" data-point cx="${mid}" cy="${toY(START_B)}" r="7"/>
  </svg>
  <figcaption>
    <p class="formula" dir="ltr" data-formula>${f}</p>
    <p class="graph-note" aria-live="polite"><span data-note>${describe(START_A)}</span><br>يقطع محور التراتيب في النقطة <bdi dir="ltr" data-intercept>${intercept(START_B)}</bdi></p>
    <div class="controls" data-controls hidden>
      <label class="control"><span class="control-name">الميل <bdi dir="ltr"><b>a</b> = <output data-out-a>${START_A}</output></bdi></span><input type="range" dir="ltr" min="-3" max="3" step="0.5" value="${START_A}" data-a></label>
      <label class="control"><span class="control-name">الترتيبة عند المبدأ <bdi dir="ltr"><b>b</b> = <output data-out-b>${START_B}</output></bdi></span><input type="range" dir="ltr" min="-6" max="6" step="1" value="${START_B}" data-b></label>
    </div>
  </figcaption>
</figure>`;
}

export function homePage(env: string): string {
  return layout({
    title: SITE_NAME,
    env,
    current: "home",
    scripts: true,
    body: html`<section class="hero">
  <div class="hero-text">
    <h1>${SITE_NAME}</h1>
    <p class="slogan"><span class="marker">${SLOGAN}</span></p>
    <p class="lead">حرّك المؤشرين وشاهد المستقيم يتغير على دفتر المربعات. هكذا نشرح كل درس: نفهم قبل أن نحفظ.</p>
    <div class="actions">
      <a class="btn btn-primary" href="/levels">تصفّح الدروس</a>
      <a class="btn btn-secondary" href="/subscribe">طريقة الاشتراك</a>
    </div>
  </div>
  ${graphFigure()}
</section>
${programGrids()}
<section aria-labelledby="how-title">
  <h2 id="how-title"><span class="marker">كيف تعمل المنصة</span></h2>
  <ol class="steps">
    <li><strong>اختر المستوى</strong><span>تصفّح الدروس المجانية دون حساب.</span></li>
    <li><strong>اشترك مع الأستاذ</strong><span>يفعّل الأستاذ حساب العائلة بعد الدفع.</span></li>
    <li><strong>تعلّم وتابع</strong><span>دروس واختبارات، ونتائج يراها الولي.</span></li>
  </ol>
</section>`,
  });
}

export function levelsPage(env: string): string {
  return layout({
    title: "الدروس",
    env,
    current: "levels",
    body: html`<h1>الدروس</h1>
<p class="lead">اختر مستوى أو دورة. المحتوى المجاني مفتوح للجميع، والمدفوع يظهر بقفل.</p>
${programGrids()}`,
  });
}

function itemRow(item: Item): Raw {
  const kind = KIND_LABELS[item.kind];
  if (item.free) {
    return html`<li>
  <a class="item item-free" href="/items/${item.id}">
    <span class="item-icon">${ICONS[item.kind]}</span>
    <span class="item-body"><span class="item-title">${item.title}</span><span class="item-kind">${kind}</span></span>
    <span class="badge badge-free">مجاني</span>
  </a>
</li>`;
  }
  return html`<li>
  <a class="item item-locked" href="/subscribe?item=${item.id}" aria-label="${item.title}، ${kind}، مقفل: يتطلب اشتراكًا">
    <span class="item-icon">${ICONS[item.kind]}</span>
    <span class="item-body"><span class="item-title">${item.title}</span><span class="item-kind">${kind}</span></span>
    <span class="badge badge-locked">${ICONS.lock}مقفل</span>
  </a>
</li>`;
}

function unitBlock(unit: Unit, index: number): Raw {
  const free = unit.items.filter((i) => i.free).length;
  const summary = html`<summary>
    <span class="unit-num" aria-hidden="true">${index + 1}</span>
    <span class="unit-text"><span class="unit-title" id="${unit.id}">${unit.title}</span><span class="unit-meta">${unit.items.length} عناصر${free ? html`، منها ${free} مجانًا` : ""}</span></span>
    <span class="unit-chevron" aria-hidden="true"></span>
  </summary>
  <ul class="items">${unit.items.map(itemRow)}</ul>`;
  return index === 0
    ? html`<details class="unit" open>${summary}</details>`
    : html`<details class="unit">${summary}</details>`;
}

export function programPage(env: string, program: Program): string {
  const { free, total } = countItems(program);
  return layout({
    title: program.title,
    env,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a> / <span aria-current="page">${program.title}</span></nav>
<header class="program-head">
  ${hexMark(program, "lg")}
  <h1>${program.title}</h1>
</header>
<p class="lead program-lead">${program.units.length} ${program.kind === "level" ? "مقاطع" : "أجزاء"}، و${total} عنصرًا منها ${free} مجانًا. اضغط على ${program.kind === "level" ? "المقطع" : "الجزء"} لعرض دروسه.</p>
<div class="units">${program.units.map(unitBlock)}</div>`,
  });
}

export function itemPage(env: string, program: Program, unit: Unit, item: Item): string {
  return layout({
    title: item.title,
    env,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a> / <a href="/levels/${program.slug}">${program.title}</a> / <span aria-current="page">${unit.title}</span></nav>
<h1>${item.title}</h1>
<p><span class="badge badge-free">مجاني</span> <span class="item-kind">${KIND_LABELS[item.kind]}</span></p>
<div class="notice">هذا عنصر تجريبي. الفيديو والملفات الحقيقية تُضاف من لوحة التحكم في المرحلة 4.</div>
<p><a class="btn btn-secondary" href="/levels/${program.slug}">العودة إلى ${program.title}</a></p>`,
  });
}

export function subscribePage(env: string, locked?: { program: Program; item: Item }): string {
  return layout({
    title: "الاشتراك",
    env,
    current: "subscribe",
    body: html`<h1>الاشتراك</h1>
${
  locked
    ? html`<div class="notice notice-lock">${ICONS.lock}<span><strong>${locked.item.title}</strong> من ${locked.program.title} ضمن المحتوى المدفوع. يُفتح بعد الاشتراك.</span></div>`
    : ""
}
<section aria-labelledby="plans-title">
  <h2 id="plans-title"><span class="marker">الباقات</span></h2>
  <ul class="plans">
    <li class="plan"><strong>باقة الفصل</strong><span>كل دروس المستوى لفصل دراسي كامل.</span></li>
    <li class="plan plan-main"><strong>الباقة السنوية</strong><span>كل دروس المستوى للسنة الدراسية.</span></li>
    <li class="plan"><strong>الدورات الخاصة</strong><span>كل دورة مفتوحة سنة كاملة من تاريخ التفعيل.</span></li>
  </ul>
</section>
<section aria-labelledby="steps-title">
  <h2 id="steps-title"><span class="marker">طريقة الاشتراك</span></h2>
  <ol class="steps">
    <li><strong>تواصل مع الأستاذ</strong><span>لاختيار الباقة المناسبة.</span></li>
    <li><strong>ادفع</strong><span>حسب معلومات الدفع التي يرسلها الأستاذ.</span></li>
    <li><strong>استلم حسابك</strong><span>ينشئ الأستاذ حساب العائلة، فتدخل برقم هاتف الولي.</span></li>
  </ol>
</section>
<div class="notice">الأسعار ومعلومات الدفع ورقم واتساب تُضاف من لوحة التحكم في المرحلة 5.</div>`,
  });
}

export function notFoundPage(env: string): string {
  return layout({
    title: "الصفحة غير موجودة",
    env,
    current: null,
    body: html`<h1>الصفحة غير موجودة</h1>
<p class="lead">الرابط غير صحيح أو أن الصفحة نُقلت.</p>
<p><a class="btn btn-primary" href="/">العودة إلى الرئيسية</a></p>`,
  });
}
