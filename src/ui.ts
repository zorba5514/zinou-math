// الهيكل المشترك لكل الصفحات: الرأس، والقائمة الجانبية، وعناصر النماذج.
// التصميم حسب مهارة zinou-design.

import { html, type Raw } from "./html.ts";
import { icon, type IconName } from "./icons.ts";
import type { Access } from "./subscriptions.ts";

export const SITE_NAME = "الأستاذ زين الدين للرياضيات";
export const SLOGAN = "الرياضيات كما يجب أن تكون";

/** من يتصفح الصفحة الآن: زائر (null) أو ولي أو الأستاذ. */
export interface Viewer {
  /** اسم الملف الظاهر: اسم الابن أو الولي أو الأستاذ */
  name: string;
  role: "parent" | "admin";
  /** للعائلات: الملف المختار بعد الدخول، أو null قبل الاختيار */
  profile?: "parent" | "student" | null;
}

/** الصفحة الرئيسية لمن دخل: لوحة التحكم، أو صفحة الابن، أو صفحة الولي، أو اختيار الملف. */
export function viewerHome(v: Viewer): string {
  if (v.role === "admin") return "/admin";
  if (v.profile === "student") return "/home";
  if (v.profile === "parent") return "/account";
  return "/profiles";
}

export interface View {
  env: string;
  viewer: Viewer | null;
  /** ما يحق لمن يتصفح فتحه من المحتوى المدفوع (اشتراكاته أو اشتراكات أبنائه). */
  access?: Access;
}

export type NavKey =
  | "home"
  | "levels"
  | "subscribe"
  | "login"
  | "account"
  | "student-home"
  | "profiles"
  | "admin"
  | "families"
  | "new-family"
  | "content"
  | "settings"
  | null;

function navItem(href: string, label: string, ic: IconName, key: NavKey, current: NavKey): Raw {
  return key === current
    ? html`<a class="nav-item" href="${href}" aria-current="page">${icon(ic)}<span>${label}</span></a>`
    : html`<a class="nav-item" href="${href}">${icon(ic)}<span>${label}</span></a>`;
}

/** الخط المتعرج أسفل الشعار، فاصل زخرفي رفيع. */
/** مثال رقم هاتف يُكتب من اليسار إلى اليمين داخل النص العربي. */
export function phoneExample(prefix = "مثال:"): Raw {
  return html`${prefix} <bdi dir="ltr">0555 12 34 56</bdi>`;
}

export const ZIGZAG = html`<svg class="zigzag" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9h14l12-6 14 7 14-7 14 6h52" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`;

function initial(name: string): string {
  return name.trim().charAt(0) || "؟";
}

export function logoutForm(className = "btn btn-secondary"): Raw {
  return html`<form method="post" action="/logout" class="inline-form"><button class="${className}" type="submit">${icon("logout")}خروج</button></form>`;
}

function drawerFooter(view: View): Raw {
  const v = view.viewer;
  if (!v) {
    return html`<a class="drawer-card" href="/login">
      <span class="drawer-card-icon">${icon("user")}</span>
      <span><strong>تسجيل الدخول</strong><small>برقم هاتف الولي</small></span>
    </a>`;
  }
  const subtitle =
    v.role === "admin" ? "الأستاذ" : v.profile === "student" ? "ملف الابن" : v.profile === "parent" ? "ملف الولي" : "اختر الملف";
  return html`<div class="drawer-user">
    <a class="drawer-card" href="${viewerHome(v)}">
      <span class="drawer-card-icon drawer-avatar">${initial(v.name)}</span>
      <span><strong>${v.name}</strong><small>${subtitle}</small></span>
    </a>
    ${v.role === "parent" && v.profile ? html`<a class="drawer-switch" href="/profiles">${icon("users")}تبديل الملف</a>` : ""}
    ${logoutForm("drawer-logout")}
  </div>`;
}

function drawerNav(area: "public" | "admin", view: View, current: NavKey): Raw {
  if (area === "admin") {
    return html`<p class="drawer-label">لوحة التحكم</p>
    <nav class="drawer-nav" aria-label="لوحة التحكم">
      ${navItem("/admin", "الرئيسية", "home", "admin", current)}
      ${navItem("/admin/families", "العائلات", "users", "families", current)}
      ${navItem("/admin/families/new", "إضافة عائلة", "userPlus", "new-family", current)}
      ${navItem("/admin/content", "المحتوى", "book", "content", current)}
      ${navItem("/admin/settings", "الإعدادات", "calendar", "settings", current)}
    </nav>
    <p class="drawer-label">الموقع</p>
    <nav class="drawer-nav" aria-label="الموقع">
      ${navItem("/", "عرض الموقع", "book", null, current)}
    </nav>`;
  }
  return html`<p class="drawer-label">القائمة الرئيسية</p>
    <nav class="drawer-nav" aria-label="القائمة الرئيسية">
      ${navItem("/", "الرئيسية", "home", "home", current)}
      ${navItem("/levels", "الدروس", "book", "levels", current)}
      ${navItem("/subscribe", "الاشتراك", "card", "subscribe", current)}
      ${view.viewer?.role === "parent" && view.viewer.profile === "student" ? navItem("/home", "صفحتي", "user", "student-home", current) : ""}
      ${view.viewer?.role === "parent" && view.viewer.profile === "parent" ? navItem("/account", "حساب العائلة", "users", "account", current) : ""}
      ${view.viewer?.role === "parent" && !view.viewer.profile ? navItem("/profiles", "اختيار الملف", "users", "profiles", current) : ""}
      ${view.viewer?.role === "admin" ? navItem("/admin", "لوحة التحكم", "layers", "admin", current) : ""}
    </nav>`;
}

export function layout(opts: {
  title: string;
  view: View;
  current: NavKey;
  body: Raw;
  description?: string;
  scripts?: string[];
  area?: "public" | "admin";
}): string {
  const fullTitle = opts.title === SITE_NAME ? SITE_NAME : `${opts.title} | ${SITE_NAME}`;
  const staging = opts.view.env !== "production";
  const area = opts.area ?? "public";
  const description =
    opts.description ?? `${SITE_NAME}: ${SLOGAN}. دروس رياضيات من الأولى متوسط إلى الأولى ثانوي.`;
  return html`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${staging || area === "admin" ? html`<meta name="robots" content="noindex">` : ""}
<meta name="theme-color" content="#16181D">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preload" href="/fonts/tajawal-ar-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/tajawal-ar-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
${opts.body.value.includes('class="katex') || (opts.scripts ?? []).some((x) => x.startsWith("/katex/")) ? html`<link rel="stylesheet" href="/katex/katex.min.css">` : ""}
${(opts.scripts ?? []).map((src) => html`<script type="module" src="${src}"></script>`)}
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
    ${drawerNav(area, opts.view, opts.current)}
    ${drawerFooter(opts.view)}
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

// ---------- عناصر النماذج ----------

export interface InputOpts {
  name: string;
  label: string;
  type?: "text" | "password" | "tel" | "date";
  value?: string;
  autocomplete?: string;
  inputmode?: "numeric" | "tel" | "text";
  required?: boolean;
  dir?: "ltr" | "rtl";
  error?: string;
  hint?: string | Raw;
  maxlength?: number;
  autofocus?: boolean;
  /** معرّف خاص عند تكرار نفس الحقل في الصفحة */
  id?: string;
}

export function input(o: InputOpts): Raw {
  const id = o.id ?? `f-${o.name}`;
  const describedBy = [o.hint ? `${id}-hint` : "", o.error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return html`<div class="field${o.error ? " field-invalid" : ""}">
  <label for="${id}">${o.label}</label>
  <input id="${id}" class="input" name="${o.name}" type="${o.type ?? "text"}"${o.value ? html` value="${o.value}"` : ""}${o.autocomplete ? html` autocomplete="${o.autocomplete}"` : ""}${o.inputmode ? html` inputmode="${o.inputmode}"` : ""}${o.dir ? html` dir="${o.dir}"` : ""}${o.maxlength ? html` maxlength="${String(o.maxlength)}"` : ""}${o.required ? html` required` : ""}${o.autofocus ? html` autofocus` : ""}${o.error ? html` aria-invalid="true"` : ""}${describedBy ? html` aria-describedby="${describedBy}"` : ""}>
  ${o.hint ? html`<p class="field-hint" id="${id}-hint">${o.hint}</p>` : ""}
  ${o.error ? html`<p class="field-error" id="${id}-error">${o.error}</p>` : ""}
</div>`;
}

export function textarea(o: { name: string; label: string; value?: string; hint?: string | Raw; error?: string; rows?: number; dir?: "ltr" | "rtl" | "auto"; maxlength?: number }): Raw {
  const id = `f-${o.name}`;
  const describedBy = [o.hint ? `${id}-hint` : "", o.error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return html`<div class="field${o.error ? " field-invalid" : ""}">
  <label for="${id}">${o.label}</label>
  <textarea id="${id}" class="input textarea" name="${o.name}" rows="${String(o.rows ?? 4)}"${o.dir ? html` dir="${o.dir}"` : ""}${o.maxlength ? html` maxlength="${String(o.maxlength)}"` : ""}${o.error ? html` aria-invalid="true"` : ""}${describedBy ? html` aria-describedby="${describedBy}"` : ""}>${o.value ?? ""}</textarea>
  ${o.hint ? html`<p class="field-hint" id="${id}-hint">${o.hint}</p>` : ""}
  ${o.error ? html`<p class="field-error" id="${id}-error">${o.error}</p>` : ""}
</div>`;
}

export function select(o: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  value?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  id?: string;
}): Raw {
  const id = o.id ?? `f-${o.name}`;
  return html`<div class="field${o.error ? " field-invalid" : ""}">
  <label for="${id}">${o.label}</label>
  <select id="${id}" class="input" name="${o.name}"${o.required ? html` required` : ""}${o.error ? html` aria-invalid="true" aria-describedby="${id}-error"` : ""}>
    ${o.placeholder !== undefined ? html`<option value="">${o.placeholder}</option>` : ""}
    ${o.options.map((opt) =>
      opt.value === o.value
        ? html`<option value="${opt.value}" selected>${opt.label}</option>`
        : html`<option value="${opt.value}">${opt.label}</option>`,
    )}
  </select>
  ${o.error ? html`<p class="field-error" id="${id}-error">${o.error}</p>` : ""}
</div>`;
}

export function alertBox(message: string | null | undefined, kind: "error" | "success" | "info" = "error"): Raw {
  if (!message) return html``;
  const ic: IconName = kind === "success" ? "check" : kind === "info" ? "info" : "alert";
  return html`<div class="alert alert-${kind}" role="${kind === "error" ? "alert" : "status"}">${icon(ic)}<p>${message}</p></div>`;
}
