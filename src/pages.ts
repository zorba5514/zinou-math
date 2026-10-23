// صفحات الموقع العامة (للزوار)، تُبنى في الخادم وتُرسل جاهزة إلى المتصفح.

import { html, type Raw } from "./html.ts";
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
}): string {
  const fullTitle = opts.title === SITE_NAME ? SITE_NAME : `${opts.title} | ${SITE_NAME}`;
  const staging = opts.env !== "production";
  return html`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${opts.description ?? `${SITE_NAME}: ${SLOGAN}. دروس رياضيات من الأولى متوسط إلى الأولى ثانوي.`}">
${staging ? html`<meta name="robots" content="noindex">` : ""}
<meta name="theme-color" content="#181818">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
${staging ? html`<p class="staging">نسخة الاختبار: المحتوى المعروض تجريبي.</p>` : ""}
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">
      <img src="/brand/logo.svg" alt="" width="44" height="39">
      <span>${SITE_NAME}</span>
    </a>
    <nav aria-label="القائمة الرئيسية">
      ${navLink("/", "الرئيسية", "home", opts.current)}
      ${navLink("/levels", "الدروس", "levels", opts.current)}
      ${navLink("/subscribe", "الاشتراك", "subscribe", opts.current)}
    </nav>
  </div>
</header>
<main id="main" class="wrap">
${opts.body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p><strong>${SITE_NAME}</strong> · ${SLOGAN}</p>
  </div>
</footer>
</body>
</html>`.value;
}

function programCard(program: Program): Raw {
  const { total, free } = countItems(program);
  return html`<li>
  <a class="card" href="/levels/${program.slug}">
    <span class="card-tag">${program.short}</span>
    <span class="card-title">${program.title}</span>
    <span class="card-meta">${program.units.length} ${program.kind === "level" ? "مقاطع" : "أجزاء"} · ${total} عنصرًا، منها ${free} مجانًا</span>
  </a>
</li>`;
}

function programGrids(): Raw {
  const levels = PROGRAMS.filter((p) => p.kind === "level");
  const courses = PROGRAMS.filter((p) => p.kind === "course");
  return html`<section aria-labelledby="levels-title">
  <h2 id="levels-title">المستويات الدراسية</h2>
  <ul class="grid">${levels.map(programCard)}</ul>
</section>
<section aria-labelledby="courses-title">
  <h2 id="courses-title">دورات خاصة</h2>
  <ul class="grid">${courses.map(programCard)}</ul>
</section>`;
}

export function homePage(env: string): string {
  return layout({
    title: SITE_NAME,
    env,
    current: "home",
    body: html`<section class="hero">
  <img class="hero-logo" src="/brand/logo.svg" alt="شعار ${SITE_NAME}" width="160" height="142">
  <h1>${SITE_NAME}</h1>
  <p class="slogan">${SLOGAN}</p>
  <p class="lead">دروس مسجلة وملفات واختبارات في الرياضيات، من الأولى متوسط إلى الأولى ثانوي.</p>
  <div class="actions">
    <a class="btn btn-primary" href="/levels">تصفّح الدروس</a>
    <a class="btn btn-secondary" href="/subscribe">طريقة الاشتراك</a>
  </div>
</section>
${programGrids()}
<section aria-labelledby="how-title">
  <h2 id="how-title">كيف تعمل المنصة</h2>
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

function unitSection(unit: Unit): Raw {
  return html`<section class="unit" aria-labelledby="${unit.id}">
  <h2 id="${unit.id}">${unit.title}</h2>
  <ul class="items">${unit.items.map(itemRow)}</ul>
</section>`;
}

export function programPage(env: string, program: Program): string {
  return layout({
    title: program.title,
    env,
    current: "levels",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/levels">الدروس</a> / <span aria-current="page">${program.title}</span></nav>
<h1>${program.title}</h1>
${program.units.map(unitSection)}`,
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
  <h2 id="plans-title">الباقات</h2>
  <ul class="grid plans">
    <li class="plan"><span class="card-title">باقة الفصل</span><span class="card-meta">كل دروس المستوى لفصل دراسي كامل.</span></li>
    <li class="plan"><span class="card-title">الباقة السنوية</span><span class="card-meta">كل دروس المستوى للسنة الدراسية.</span></li>
    <li class="plan"><span class="card-title">الدورات الخاصة</span><span class="card-meta">كل دورة مفتوحة سنة كاملة من تاريخ التفعيل.</span></li>
  </ul>
</section>
<section aria-labelledby="steps-title">
  <h2 id="steps-title">طريقة الاشتراك</h2>
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
