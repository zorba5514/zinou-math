// صفحات العائلة بعد الدخول: اختيار الملف، والرمز السري، وصفحة الولي، وصفحة الابن.

import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, layout, logoutForm, type View } from "./ui.ts";
import { LEVELS, levelTitle } from "./content.ts";
import { formatPhone } from "./phone.ts";
import type { Account, Device, Student } from "./db.ts";

function initial(name: string): string {
  return name.trim().charAt(0) || "؟";
}

/** زر يختار ملفًا (نموذج صغير لأن تغيير الملف يغيّر الجلسة). */
function selectForm(kind: "parent" | "student", id: number | null, inner: Raw, className: string): Raw {
  return html`<form method="post" action="/profiles/select" class="profile-form">
  <input type="hidden" name="kind" value="${kind}">
  ${id !== null ? html`<input type="hidden" name="student_id" value="${String(id)}">` : ""}
  <button class="${className}" type="submit">${inner}</button>
</form>`;
}

// ---------- اختيار الملف ----------

export function profilesPage(view: View, account: Account, students: Student[]): string {
  return layout({
    title: "من يستعمل المنصة الآن؟",
    view,
    current: "profiles",
    body: html`<header class="page-head page-head-center">
  <h1>من يستعمل المنصة الآن؟</h1>
  <p class="muted">اختر ملفك. كل ابن يرى دروسه ونتائجه، والولي يتابع الجميع.</p>
</header>
<ul class="profiles">
  ${students.map(
    (s) => html`<li>${selectForm(
      "student",
      s.id,
      html`<span class="profile-avatar">${initial(s.name)}</span>
      <span class="profile-name">${s.name}</span>
      <span class="profile-meta">${levelTitle(s.level)}</span>
      ${s.pin_hash ? html`<span class="profile-lock" aria-label="محمي برمز">${icon("lock", "icon icon-sm")}</span>` : ""}`,
      "card profile-card",
    )}</li>`,
  )}
  <li>${selectForm(
    "parent",
    null,
    html`<span class="profile-avatar profile-avatar-parent">${icon("users")}</span>
    <span class="profile-name">الولي</span>
    <span class="profile-meta">${account.name}</span>
    ${account.parent_pin_hash ? html`<span class="profile-lock" aria-label="محمي برمز">${icon("lock", "icon icon-sm")}</span>` : ""}`,
    "card profile-card",
  )}</li>
</ul>
<div class="actions actions-center">${logoutForm()}</div>`,
  });
}

// ---------- الرمز السري للملف ----------

export function unlockPage(
  view: View,
  o: { kind: "parent" | "student"; studentId: number | null; name: string; error?: string },
): string {
  return layout({
    title: "رمز الملف",
    view,
    current: "profiles",
    body: html`<section class="card auth-card">
  <span class="icon-box icon-box-lg">${icon("lock")}</span>
  <h1>${o.name}</h1>
  <p class="muted">هذا الملف محمي برمز من 4 أرقام.</p>
  ${alertBox(o.error)}
  <form method="post" action="/profiles/unlock" class="form" novalidate>
    <input type="hidden" name="kind" value="${o.kind}">
    ${o.studentId !== null ? html`<input type="hidden" name="student_id" value="${String(o.studentId)}">` : ""}
    ${input({ name: "pin", label: "الرمز", type: "password", inputmode: "numeric", autocomplete: "off", dir: "ltr", required: true, autofocus: true, maxlength: 4 })}
    <button class="btn btn-primary btn-block" type="submit">دخول ${icon("arrowLeft")}</button>
  </form>
  <p class="auth-note"><a href="/profiles">العودة إلى اختيار الملف</a></p>
  <p class="auth-note small">نسيت الرمز؟ يستطيع الولي تغييره من ملفه، أو يمسحه الأستاذ.</p>
</section>`,
  });
}

// ---------- صفحة الابن ----------

export function studentHomePage(view: View, student: Student): string {
  const program = LEVELS.find((l) => l.slug === student.level);
  return layout({
    title: student.name,
    view,
    current: "student-home",
    body: html`<section class="card hero">
  <span class="badge-pill"><span class="dot"></span>مرحبًا بك</span>
  <h1>${student.name}</h1>
  <p class="muted hero-text">${levelTitle(student.level)}</p>
  <div class="actions">
    ${program ? html`<a class="btn btn-primary" href="/levels/${program.slug}">دروس ${program.short} ${icon("arrowLeft")}</a>` : ""}
    <a class="btn btn-secondary" href="/profiles">${icon("users")}تبديل الملف</a>
  </div>
</section>`,
  });
}

// ---------- صفحة الولي ----------

function deviceStatusPill(d: Device): Raw {
  return d.status === "approved"
    ? html`<span class="pill pill-success">معتمد</span>`
    : html`<span class="pill pill-warning">بانتظار الأستاذ</span>`;
}

export function parentPage(view: View, account: Account, students: Student[], devices: Device[]): string {
  return layout({
    title: "حساب العائلة",
    view,
    current: "account",
    body: html`<section class="card hero">
  <span class="badge-pill"><span class="dot"></span>ملف الولي</span>
  <h1>${account.name}</h1>
  <p class="muted hero-text">حساب العائلة: <bdi dir="ltr">${formatPhone(account.phone)}</bdi></p>
  <div class="actions">
    <a class="btn btn-secondary" href="/account/pins">${icon("lock")}رموز الملفات</a>
    <a class="btn btn-secondary" href="/account/password">${icon("key")}كلمة المرور</a>
  </div>
</section>
<section class="section" aria-labelledby="kids-title">
  <h2 id="kids-title">الأبناء</h2>
  ${
    students.length
      ? html`<ul class="card-grid">${students.map(
          (s) => html`<li class="card program-card">
      <span class="profile-avatar profile-avatar-sm">${initial(s.name)}</span>
      <span class="program-title">${s.name}</span>
      <span class="program-meta">${levelTitle(s.level)}</span>
      ${selectForm("student", s.id, html`فتح ملفه ${icon("arrowLeft")}`, "btn btn-secondary btn-sm btn-block")}
    </li>`,
        )}</ul>`
      : html`<div class="card empty"><p>لم يُضف أي ابن إلى هذا الحساب بعد. تواصل مع الأستاذ لإضافته.</p></div>`
  }
</section>
<section class="section" aria-labelledby="devices-title">
  <h2 id="devices-title">الأجهزة</h2>
  <ul class="card device-list">${devices.map(
    (d) => html`<li><span class="icon-box icon-box-sm icon-box-soft">${icon("phone")}</span><span class="device-main"><strong>${d.label ?? "جهاز"}</strong><small>${d.status === "approved" ? "يستطيع الدخول إلى الحساب" : "لا يستطيع الدخول حتى يوافق الأستاذ"}</small></span>${deviceStatusPill(d)}</li>`,
  )}</ul>
  <p class="muted small">لإضافة جهاز جديد ادخل منه بنفس الحساب، ثم اطلب من الأستاذ الموافقة. لإزالة جهاز تواصل مع الأستاذ.</p>
</section>`,
  });
}

// ---------- رموز الملفات ----------

export interface PinProfile {
  key: string;
  name: string;
  hasPin: boolean;
}

export function pinsPage(
  view: View,
  profiles: PinProfile[],
  o: { done?: string | null; errorKey?: string; error?: string } = {},
): string {
  const doneText: Record<string, string> = { set: "حُفظ الرمز.", cleared: "أُزيل الرمز." };
  return layout({
    title: "رموز الملفات",
    view,
    current: "account",
    body: html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/account">حساب العائلة</a><span aria-hidden="true">/</span><span aria-current="page">رموز الملفات</span></nav>
<header class="page-head">
  <h1>رموز الملفات</h1>
  <p class="muted">رمز من 4 أرقام يمنع الإخوة من الدخول إلى ملفات بعضهم. ضع رمزًا لملف الولي أيضًا، لأن ملف الولي يفتح ملفات كل الأبناء.</p>
</header>
${alertBox(o.done ? doneText[o.done] : null, "success")}
<div class="pin-grid">
${profiles.map(
  (p) => html`<section class="card form-card">
  <h2>${p.name} ${p.hasPin ? html`<span class="pill pill-success">${icon("lock", "icon icon-sm")}محمي</span>` : html`<span class="pill pill-muted">بدون رمز</span>`}</h2>
  ${o.errorKey === p.key ? alertBox(o.error) : ""}
  <form method="post" action="/account/pins" class="form" novalidate>
    <input type="hidden" name="target" value="${p.key}">
    <input type="hidden" name="action" value="set">
    <div class="pin-pair">
      ${input({ name: "pin", label: p.hasPin ? "رمز جديد" : "الرمز", type: "password", inputmode: "numeric", autocomplete: "new-password", dir: "ltr", maxlength: 4, required: true })}
      ${input({ name: "confirm", label: "أعد كتابته", type: "password", inputmode: "numeric", autocomplete: "new-password", dir: "ltr", maxlength: 4, required: true })}
    </div>
    <button class="btn btn-primary btn-sm" type="submit">${p.hasPin ? "تغيير الرمز" : "وضع الرمز"}</button>
  </form>
  ${
    p.hasPin
      ? html`<form method="post" action="/account/pins" class="pin-remove">
    <input type="hidden" name="target" value="${p.key}">
    <input type="hidden" name="action" value="clear">
    <button class="btn-link" type="submit">إزالة الرمز</button>
  </form>`
      : ""
  }
</section>`,
)}
</div>`,
  });
}
