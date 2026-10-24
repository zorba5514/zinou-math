// صفحات الدخول والحساب: الدخول، والرمز ذو الأرقام الستة، وتغيير كلمة المرور، وتأسيس حساب الأستاذ.

import { html, Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, layout, logoutForm, phoneExample, type View } from "./ui.ts";
import { findProgram } from "./catalog.ts";
import { formatPhone } from "./phone.ts";
import type { Account, Student } from "./db.ts";

function authCard(title: string, lead: string, ic: Parameters<typeof icon>[0], body: Raw): Raw {
  return html`<section class="card auth-card">
  <span class="icon-box icon-box-lg">${icon(ic)}</span>
  <h1>${title}</h1>
  <p class="muted">${lead}</p>
  ${body}
</section>`;
}

export function loginPage(view: View, o: { phone?: string; error?: string; next?: string } = {}): string {
  return layout({
    title: "تسجيل الدخول",
    view,
    current: "login",
    body: authCard(
      "تسجيل الدخول",
      "ادخل برقم هاتف الولي وكلمة المرور التي أرسلها لك الأستاذ.",
      "user",
      html`${alertBox(o.error)}
  <form method="post" action="/login" class="form" novalidate>
    ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ""}
    ${input({ name: "phone", label: "رقم الهاتف", type: "tel", inputmode: "tel", autocomplete: "username", dir: "ltr", value: o.phone, required: true, autofocus: !o.phone, hint: phoneExample() })}
    ${input({ name: "password", label: "كلمة المرور", type: "password", autocomplete: "current-password", dir: "ltr", required: true, autofocus: Boolean(o.phone) })}
    <button class="btn btn-primary btn-block" type="submit">دخول ${icon("arrowLeft")}</button>
  </form>
  <p class="auth-note">ليس لديك حساب؟ الحسابات ينشئها الأستاذ بعد الاشتراك. <a href="/subscribe">طريقة الاشتراك</a></p>`,
    ),
  });
}

export function verifyPage(view: View, o: { error?: string } = {}): string {
  return layout({
    title: "رمز التحقق",
    view,
    current: "login",
    body: authCard(
      "رمز التحقق",
      "افتح تطبيق Google Authenticator واكتب الرمز المكوّن من 6 أرقام.",
      "shield",
      html`${alertBox(o.error)}
  <form method="post" action="/login/verify" class="form" novalidate>
    ${input({ name: "code", label: "الرمز", inputmode: "numeric", autocomplete: "one-time-code", dir: "ltr", required: true, autofocus: true, maxlength: 11, hint: "إذا ضاع هاتفك، اكتب أحد رموز الطوارئ بدل الرمز." })}
    <label class="check"><input type="checkbox" name="remember" value="1" checked><span>تذكّر هذا الجهاز، فلا يُطلب الرمز عليه مرة أخرى لمدة سنة</span></label>
    <button class="btn btn-primary btn-block" type="submit">تحقق ${icon("arrowLeft")}</button>
  </form>
  <form method="post" action="/logout" class="auth-note"><button class="btn-link" type="submit">إلغاء والعودة</button></form>`,
    ),
  });
}

export function passwordPage(
  view: View,
  o: { forced: boolean; error?: string; errors?: Record<string, string>; success?: boolean },
): string {
  const e = o.errors ?? {};
  return layout({
    title: "تغيير كلمة المرور",
    view,
    current: "account",
    body: authCard(
      o.forced ? "اختر كلمة مرور جديدة" : "تغيير كلمة المرور",
      o.forced
        ? "هذه أول مرة تدخل فيها. اختر كلمة مرور خاصة بك تحل محل كلمة المرور المؤقتة."
        : "اكتب كلمة المرور الحالية ثم الجديدة.",
      "key",
      html`${alertBox(o.error)}${o.success ? alertBox("تم تغيير كلمة المرور.", "success") : ""}
  <form method="post" action="/account/password" class="form" novalidate>
    ${o.forced ? "" : input({ name: "current", label: "كلمة المرور الحالية", type: "password", autocomplete: "current-password", dir: "ltr", required: true, error: e.current })}
    ${input({ name: "password", label: "كلمة المرور الجديدة", type: "password", autocomplete: "new-password", dir: "ltr", required: true, error: e.password, hint: "8 حروف أو أرقام على الأقل." })}
    ${input({ name: "confirm", label: "أعد كتابة كلمة المرور الجديدة", type: "password", autocomplete: "new-password", dir: "ltr", required: true, error: e.confirm })}
    <button class="btn btn-primary btn-block" type="submit">حفظ كلمة المرور</button>
  </form>`,
    ),
  });
}

export function accountPage(view: View, account: Account, students: Student[]): string {
  return layout({
    title: "حسابي",
    view,
    current: "account",
    body: html`<section class="card hero">
  <span class="badge-pill"><span class="dot"></span>مرحبًا بعودتك</span>
  <h1>${account.name}</h1>
  <p class="muted hero-text">حساب العائلة: <bdi dir="ltr">${formatPhone(account.phone)}</bdi></p>
  <div class="actions">
    <a class="btn btn-secondary" href="/account/password">${icon("key")}تغيير كلمة المرور</a>
    ${logoutForm()}
  </div>
</section>
<section class="section" aria-labelledby="kids-title">
  <h2 id="kids-title">الأبناء</h2>
  ${
    students.length
      ? html`<ul class="card-grid">${students.map((s) => {
          const program = findProgram(s.level);
          return html`<li class="card program-card">
      <span class="icon-box">${icon("user")}</span>
      <span class="program-title">${s.name}</span>
      <span class="program-meta">${program?.title ?? s.level}</span>
      ${program ? html`<a class="btn btn-secondary btn-sm btn-block" href="/levels/${program.slug}">الدروس ${icon("arrowLeft")}</a>` : ""}
    </li>`;
        })}</ul>`
      : html`<div class="card empty"><p>لم يُضف أي ابن إلى هذا الحساب بعد. تواصل مع الأستاذ لإضافته.</p></div>`
  }
</section>`,
  });
}

export function setupUnavailablePage(view: View): string {
  return layout({
    title: "تأسيس حساب الأستاذ",
    view,
    current: null,
    body: authCard(
      "التأسيس غير مفعّل",
      "لإنشاء حساب الأستاذ يجب أولًا إضافة رمز التأسيس ADMIN_SETUP_CODE في أسرار GitHub ثم إعادة النشر.",
      "shield",
      html``,
    ),
  });
}

export function setupPage(
  view: View,
  o: { secret: string; qr: string; values?: Record<string, string>; errors?: Record<string, string>; error?: string },
): string {
  const v = o.values ?? {};
  const e = o.errors ?? {};
  return layout({
    title: "تأسيس حساب الأستاذ",
    view,
    current: null,
    body: html`<header class="page-head">
  <h1>تأسيس حساب الأستاذ</h1>
  <p class="muted">خطوة تُنجز مرة واحدة فقط. بعدها تُغلق هذه الصفحة نهائيًا.</p>
</header>
${alertBox(o.error)}
<form method="post" action="/setup" class="setup-grid" novalidate>
  <input type="hidden" name="secret" value="${o.secret}">
  <section class="card form-card">
    <h2><span class="step-num-inline">1</span>بياناتك</h2>
    ${input({ name: "setup_code", label: "رمز التأسيس", type: "password", autocomplete: "off", required: true, error: e.setup_code, hint: html`العبارة التي وضعتها في أسرار GitHub باسم <bdi dir="ltr">ADMIN_SETUP_CODE</bdi>.` })}
    ${input({ name: "name", label: "الاسم الذي يظهر في المنصة", value: v.name, required: true, error: e.name, maxlength: 80 })}
    ${input({ name: "phone", label: "رقم هاتفك (اسم المستخدم)", type: "tel", inputmode: "tel", autocomplete: "username", dir: "ltr", value: v.phone, required: true, error: e.phone })}
    ${input({ name: "password", label: "كلمة المرور", type: "password", autocomplete: "new-password", dir: "ltr", required: true, error: e.password, hint: "8 حروف أو أرقام على الأقل." })}
    ${input({ name: "confirm", label: "أعد كتابة كلمة المرور", type: "password", autocomplete: "new-password", dir: "ltr", required: true, error: e.confirm })}
  </section>
  <section class="card form-card">
    <h2><span class="step-num-inline">2</span>ربط تطبيق المصادقة</h2>
    <ol class="mini-steps">
      <li>افتح Google Authenticator واضغط على <strong>+</strong>.</li>
      <li>اختر <strong>مسح رمز QR</strong> ووجّه الكاميرا إلى الرمز.</li>
      <li>اكتب الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.</li>
    </ol>
    <div class="qr-box">${new Raw(o.qr)}</div>
    <details class="manual-key"><summary>لا تستطيع المسح؟ اكتب المفتاح يدويًا</summary><p dir="ltr" class="mono">${o.secret.replace(/(.{4})/g, "$1 ").trim()}</p></details>
    ${input({ name: "totp", label: "الرمز من التطبيق", inputmode: "numeric", autocomplete: "one-time-code", dir: "ltr", required: true, error: e.totp, maxlength: 6 })}
    <button class="btn btn-primary btn-block" type="submit">إنشاء حساب الأستاذ</button>
  </section>
</form>`,
  });
}

export function setupDonePage(view: View, codes: string[]): string {
  return layout({
    title: "تم إنشاء حساب الأستاذ",
    view,
    current: null,
    scripts: ["/admin.js"],
    body: html`<section class="card hero hero-compact">
  <span class="icon-box icon-box-lg icon-box-success">${icon("check")}</span>
  <h1>تم إنشاء حسابك</h1>
  <p class="muted">بقيت خطوة أخيرة مهمة: احفظ رموز الطوارئ.</p>
</section>
<section class="card form-card">
  <h2>رموز الطوارئ</h2>
  ${alertBox("إذا ضاع هاتفك أو حذفت التطبيق، تدخل بأحد هذه الرموز بدل الرمز ذي الأرقام الستة. كل رمز يعمل مرة واحدة. هذه الصفحة لن تظهر مرة أخرى: انسخها الآن واحفظها في مكان آمن خارج الهاتف (ورقة أو بريدك).", "info")}
  <ul class="codes" dir="ltr" data-copy-source="codes">${codes.map((c) => html`<li>${c}</li>`)}</ul>
  <div class="actions">
    <button class="btn btn-secondary" type="button" data-copy="codes" hidden>${icon("copy")}<span>نسخ الرموز</span></button>
    <a class="btn btn-primary" href="/admin">حفظتها، انتقل إلى لوحة التحكم ${icon("arrowLeft")}</a>
  </div>
</section>`,
  });
}

export function messagePage(view: View, title: string, text: string, status: "error" | "info" = "info"): string {
  return layout({
    title,
    view,
    current: null,
    body: authCard(title, text, status === "error" ? "alert" : "info", html`<div class="actions actions-center"><a class="btn btn-primary" href="/">العودة إلى الرئيسية</a></div>`),
  });
}
