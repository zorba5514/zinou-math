// صفحات لوحة تحكم الأستاذ: العائلات وحساباتها.

import { html, type Raw } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, layout, phoneExample, select, type View } from "./ui.ts";
import { LEVELS, levelTitle } from "./content.ts";
import { formatPhone, whatsappNumber } from "./phone.ts";
import type { Account, Device, Student } from "./db.ts";
import type { Program } from "./content.ts";
import { KIND_TITLES, computeEnd, counts, formatDate, statusClass, statusLabel, subscriptionStatus, type Settings, type SubKind, type SubStatus, type Subscription } from "./subscriptions.ts";
import { PAY_GRACE_DAYS, currentTerm, formatAmount, type Payment, type UnpaidRow } from "./payments.ts";

export const LEVEL_OPTIONS = LEVELS.map((l) => ({ value: l.slug, label: l.title }));
export const CHILD_SLOTS = 4;

export type FamilyState = "active" | "new" | "locked" | "disabled";

export function familyState(a: Account, now: number): FamilyState {
  if (a.status === "disabled") return "disabled";
  if (a.locked_until && a.locked_until > now) return "locked";
  if (a.must_change_password) return "new";
  return "active";
}

function statePill(state: FamilyState): Raw {
  switch (state) {
    case "disabled":
      return html`<span class="pill pill-danger">${icon("ban", "icon icon-sm")}موقوف</span>`;
    case "locked":
      return html`<span class="pill pill-warning">${icon("lock", "icon icon-sm")}مقفل مؤقتًا</span>`;
    case "new":
      return html`<span class="pill pill-muted">لم يدخل بعد</span>`;
    default:
      return html`<span class="pill pill-success">نشط</span>`;
  }
}

export function adminLayout(view: View, title: string, current: Parameters<typeof layout>[0]["current"], body: Raw, scripts?: string[]): string {
  return layout({ title, view, current, body, area: "admin", scripts });
}

// ---------- الأجهزة ----------

/** زر صغير يرسل إجراءً على جهاز، ويعود إلى الصفحة التي جاء منها. */
function deviceAction(id: number, action: "approve" | "remove", back: string, label: string, className: string): Raw {
  return html`<form method="post" action="/admin/devices/${String(id)}/${action}">
  <input type="hidden" name="back" value="${back}">
  <button class="${className}" type="submit">${label}</button>
</form>`;
}

function pendingDevicesSection(devices: PendingDevice[]): Raw {
  if (!devices.length) return html``;
  return html`<section class="section" aria-labelledby="dev-title">
  <h2 id="dev-title">أجهزة بانتظار موافقتك <span class="pill pill-warning">${devices.length}</span></h2>
  <ul class="card device-list">${devices.map(
    (d) => html`<li>
    <span class="icon-box icon-box-sm icon-box-soft">${icon("phone")}</span>
    <span class="device-main"><strong><a href="/admin/families/${String(d.account_id)}">${d.name}</a></strong><small>${d.label ?? "جهاز"} · <bdi dir="ltr">${formatPhone(d.phone)}</bdi> · ${when(d.created_at)}</small></span>
    <span class="device-actions">
      ${deviceAction(d.id, "approve", "dashboard", "موافقة", "btn btn-primary btn-sm")}
      ${deviceAction(d.id, "remove", "dashboard", "رفض", "btn btn-secondary btn-sm")}
    </span>
  </li>`,
  )}</ul>
  <p class="muted small">وافق فقط إذا طلب منك الولي ذلك. الجهاز المرفوض لا يستطيع الدخول.</p>
</section>`;
}

// ---------- الدفع المنتظر ----------

function unpaidSection(rows: UnpaidRow[]): Raw {
  if (!rows.length) return html``;
  const now = Date.now();
  // عائلة واحدة في سطر واحد، بأقرب أجل
  const families = new Map<number, { parent: string; items: UnpaidRow[] }>();
  for (const r of rows) {
    const f = families.get(r.account_id) ?? { parent: r.parent, items: [] };
    f.items.push(r);
    families.set(r.account_id, f);
  }
  const overdue = rows.filter((r) => r.pay_due_at < now).length;
  return html`<section class="section" aria-labelledby="unpaid-title">
  <h2 id="unpaid-title">بانتظار الدفع <span class="pill ${overdue ? "pill-danger" : "pill-warning"}">${families.size}</span></h2>
  <ul class="card device-list">${[...families].map(([accountId, f]) => {
    const first = Math.min(...f.items.map((i) => i.pay_due_at));
    const late = first < now;
    return html`<li>
    <span class="icon-box icon-box-sm ${late ? "icon-box-danger" : "icon-box-soft"}">${icon("card")}</span>
    <span class="device-main"><strong><a href="/admin/families/${String(accountId)}#subs">${f.parent}</a></strong><small>${f.items.map((i, k) => html`${k ? "، " : ""}${i.student} (${i.program})`)}</small></span>
    <span class="pill ${late ? "pill-danger" : "pill-warning"}">${late ? "انتهت المهلة: الاشتراك متوقف" : `حتى ${formatDate(first)}`}</span>
  </li>`;
  })}</ul>
</section>`;
}

// ---------- لوحة التحكم ----------

export interface PendingDevice {
  id: number;
  label: string | null;
  created_at: number;
  account_id: number;
  name: string;
  phone: string;
}

export interface EndingSoon {
  id: number;
  kind: SubKind;
  ends_at: number;
  program_slug: string;
  student: string;
  account_id: number;
  parent: string;
  program: string;
}

export interface DashboardData {
  families: number;
  students: number;
  locked: number;
  pending: number;
  devices: PendingDevice[];
  ending: EndingSoon[];
  grading: { id: number; submitted_at: number; student: string; quiz: string }[];
  unpaid: UnpaidRow[];
  recent: { at: number; action: string; detail: string | null; name: string | null }[];
}

const ACTION_LABELS: Record<string, string> = {
  "family.created": "إنشاء عائلة",
  "family.updated": "تعديل بيانات عائلة",
  "family.password_reset": "كلمة مرور مؤقتة جديدة",
  "family.disabled": "إيقاف حساب",
  "family.enabled": "تفعيل حساب",
  "family.unlocked": "رفع القفل",
  "student.added": "إضافة ابن",
  "student.updated": "تعديل بيانات ابن",
  "account.locked": "قفل بعد محاولات خاطئة",
  "password.changed": "تغيير كلمة المرور",
  "admin.created": "إنشاء حساب الأستاذ",
  "device.trusted": "اعتماد جهاز للأستاذ",
  "recovery_code.used": "استعمال رمز طوارئ",
  "device.first": "أول جهاز للعائلة",
  "device.requested": "طلب جهاز جديد",
  "device.approved": "الموافقة على جهاز",
  "device.removed": "إزالة جهاز",
  "devices.reset": "إعادة ضبط الأجهزة",
  "pins.cleared": "مسح رموز الملفات",
  "pin.set": "وضع رمز ملف",
  "pin.cleared": "إزالة رمز ملف",
  "pin.locked": "قفل ملف بعد رموز خاطئة",
  "subscription.activated": "تفعيل اشتراك",
  "subscription.deleted": "حذف اشتراك",
  "settings.updated": "تعديل الإعدادات",
  "payment.recorded": "تسجيل دفعة",
  "quiz.added": "إنشاء اختبار",
  "course.added": "إضافة دورة",
  "course.updated": "تعديل اسم دورة",
  "course.deleted": "حذف دورة",
  "unit.added": "إضافة مقطع",
  "unit.published": "نشر مقطع",
  "unit.hidden": "إخفاء مقطع",
  "unit.deleted": "حذف مقطع",
  "lessons.published": "نشر دروس مقطع",
  "lesson.updated": "تعديل درس",
  "lesson.deleted": "حذف درس",
  "playlist.imported": "استيراد قائمة تشغيل",
  "videos.added": "إضافة فيديوهات",
  "pdf.uploaded": "رفع ملف PDF",
  "attempt.submitted": "تسليم اختبار",
  "attempt.graded": "تصحيح محاولة",
  "quiz.released": "نشر نتائج اختبار",
  "quiz.hidden": "إخفاء نتائج اختبار",
  login: "تسجيل دخول",
  logout: "تسجيل خروج",
};

export function when(at: number): string {
  return new Intl.DateTimeFormat("ar-DZ-u-nu-latn", {
    timeZone: "Africa/Algiers",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
}

export function dashboardPage(view: View, d: DashboardData): string {
  return adminLayout(
    view,
    "لوحة التحكم",
    "admin",
    html`<section class="card hero">
  <span class="badge-pill"><span class="dot"></span>لوحة التحكم</span>
  <h1>مرحبًا، ${view.viewer?.name ?? ""}</h1>
  <p class="muted hero-text">من هنا تنشئ حسابات العائلات وتتابعها.</p>
  <div class="actions">
    <a class="btn btn-primary" href="/admin/families/new">${icon("userPlus")}إضافة عائلة</a>
    <a class="btn btn-secondary" href="/admin/families">${icon("users")}كل العائلات</a>
    <a class="btn btn-secondary" href="/admin/content">${icon("book")}المحتوى</a>
  </div>
</section>
${pendingDevicesSection(d.devices)}
${unpaidSection(d.unpaid)}
${
  d.grading.length
    ? html`<section class="section" aria-labelledby="grading-title">
  <h2 id="grading-title">بانتظار تصحيحك <span class="pill pill-warning">${d.grading.length}</span></h2>
  <ul class="card device-list">${d.grading.map(
    (g) => html`<li>
    <span class="icon-box icon-box-sm icon-box-soft">${icon("quiz")}</span>
    <span class="device-main"><strong><a href="/admin/attempts/${String(g.id)}">${g.student}</a></strong><small>${g.quiz} · ${when(g.submitted_at)}</small></span>
  </li>`,
  )}</ul>
</section>`
    : ""
}
${
  d.ending.length
    ? html`<section class="section" aria-labelledby="ending-title">
  <h2 id="ending-title">اشتراكات تنتهي خلال 7 أيام <span class="pill pill-warning">${d.ending.length}</span></h2>
  <ul class="card device-list">${d.ending.map(
    (e) => html`<li>
    <span class="icon-box icon-box-sm icon-box-soft">${icon("card")}</span>
    <span class="device-main"><strong><a href="/admin/families/${String(e.account_id)}#subs">${e.student}</a></strong><small>${e.program} · ${KIND_TITLES[e.kind]} · ينتهي ${formatDate(e.ends_at)} · الولي: ${e.parent}</small></span>
  </li>`,
  )}</ul>
</section>`
    : ""
}
<ul class="stats stats-4">
  <li class="card stat"><span class="icon-box">${icon("users")}</span><strong>${d.families}</strong><span class="muted">عائلة</span></li>
  <li class="card stat"><span class="icon-box icon-box-soft">${icon("user")}</span><strong>${d.students}</strong><span class="muted">تلميذ</span></li>
  <li class="card stat"><span class="icon-box icon-box-soft">${icon("key")}</span><strong>${d.pending}</strong><span class="muted">لم يدخلوا بعد</span></li>
  <li class="card stat"><span class="icon-box ${d.locked ? "icon-box-danger" : "icon-box-soft"}">${icon("lock")}</span><strong>${d.locked}</strong><span class="muted">مقفل مؤقتًا</span></li>
</ul>
<section class="section" aria-labelledby="log-title">
  <h2 id="log-title">آخر العمليات</h2>
  ${
    d.recent.length
      ? html`<ul class="card log">${d.recent.map(
          (r) => html`<li><span class="log-when">${when(r.at)}</span><span><strong>${ACTION_LABELS[r.action] ?? r.action}</strong>${r.name ? html` · ${r.name}` : ""}${r.detail ? html` <span class="muted">(<bdi>${r.detail}</bdi>)</span>` : ""}</span></li>`,
        )}</ul>`
      : html`<div class="card empty"><p>لا توجد عمليات بعد.</p></div>`
  }
</section>
<p class="muted small"><a href="/admin/settings">الإعدادات: الفصول والأسعار والدفع وواتساب</a> · <a href="/account/password">تغيير كلمة مرور الأستاذ</a></p>`,
  );
}

// ---------- قائمة العائلات ----------

export interface FamilyRow {
  account: Account;
  children: string[];
}

export function familiesPage(view: View, rows: FamilyRow[], q: string, now: number): string {
  return adminLayout(
    view,
    "العائلات",
    "families",
    html`<header class="page-head page-head-row">
  <div><h1>العائلات</h1><p class="muted">${rows.length} ${q ? "نتيجة" : "عائلة"}</p></div>
  <a class="btn btn-primary" href="/admin/families/new">${icon("userPlus")}إضافة عائلة</a>
</header>
<form class="search" method="get" action="/admin/families" role="search">
  <label class="sr-only" for="q">بحث</label>
  <span class="search-icon">${icon("search")}</span>
  <input id="q" class="input" name="q" type="search" value="${q}" placeholder="ابحث باسم الولي أو الابن أو رقم الهاتف">
</form>
${
  rows.length
    ? html`<ul class="family-list">${rows.map(
        ({ account, children }) => html`<li>
  <a class="card family-row" href="/admin/families/${String(account.id)}">
    <span class="avatar">${account.name.trim().charAt(0)}</span>
    <span class="family-main">
      <span class="family-name">${account.name}</span>
      <span class="family-meta"><bdi dir="ltr">${formatPhone(account.phone)}</bdi>${children.length ? html` · ${children.join("، ")}` : ""}</span>
    </span>
    ${statePill(familyState(account, now))}
  </a>
</li>`,
      )}</ul>`
    : q
      ? html`<div class="card empty"><p>لا توجد عائلة تطابق «${q}».</p></div>`
      : html`<div class="card empty"><p>لم تُنشئ أي عائلة بعد.</p><a class="btn btn-primary" href="/admin/families/new">${icon("userPlus")}أنشئ أول عائلة</a></div>`
}`,
  );
}

// ---------- إنشاء عائلة ----------

export interface NewFamilyValues {
  name: string;
  phone: string;
  note: string;
  children: { name: string; level: string; package: string }[];
  amount: string;
  receipt: string;
}

export interface TermInfo {
  settings: Settings;
  now: number;
}

/** خيارات باقة المستوى عند الإنشاء: الفصول بتواريخ نهايتها، والسنة، أو بدون اشتراك. */
export function levelPackageOptions(t: TermInfo): { value: string; label: string }[] {
  const label = (k: SubKind) => {
    const end = computeEnd(k, t.settings, t.now);
    return end.ok ? `${KIND_TITLES[k]} (حتى ${formatDate(end.endsAt)})` : `${KIND_TITLES[k]} (انتهى أو تاريخه غير مكتوب)`;
  };
  return [
    ...(["term1", "term2", "term3", "year"] as const).map((k) => ({ value: k, label: label(k) })),
    { value: "none", label: "بدون اشتراك الآن" },
  ];
}

export function defaultPackage(t: TermInfo): string {
  return currentTerm(t.settings, t.now) ?? "none";
}

/** خانتا المبلغ ورقم الوصل، مع شرح المهلة. */
function paymentFields(v: { amount?: string; receipt?: string }, e: Record<string, string>, idPrefix = "f"): Raw {
  return html`<div class="pay-fields">
    ${input({ name: "amount", id: `${idPrefix}-amount`, label: "المبلغ المدفوع (دج)", value: v.amount, inputmode: "numeric", dir: "ltr", error: e.amount, hint: `اكتب المبلغ المكتوب في الوصل. يُقسَّم بالتساوي على الأبناء. إن تركته فارغًا يبقى الاشتراك مفعّلًا ${PAY_GRACE_DAYS} يومًا في انتظار الدفع.` })}
    ${input({ name: "receipt", id: `${idPrefix}-receipt`, label: "رقم الوصل (اختياري)", value: v.receipt, maxlength: 60 })}
  </div>`;
}

export function newFamilyPage(view: View, v: NewFamilyValues, terms: TermInfo, errors: Record<string, string> = {}): string {
  const slots = Array.from({ length: CHILD_SLOTS }, (_, i) => v.children[i] ?? { name: "", level: "", package: "" });
  return adminLayout(
    view,
    "إضافة عائلة",
    "new-family",
    html`<header class="page-head">
  <h1>إضافة عائلة</h1>
  <p class="muted">ينشئ النظام كلمة مرور مؤقتة تُرسلها للولي عبر واتساب، ويُطلب منه تغييرها عند أول دخول.</p>
</header>
${alertBox(Object.keys(errors).length ? "راجع الخانات المشار إليها." : null)}
<form method="post" action="/admin/families/new" class="form-stack" novalidate>
  <section class="card form-card">
    <h2>الولي</h2>
    ${input({ name: "name", label: "اسم الولي", value: v.name, required: true, error: errors.name, maxlength: 80 })}
    ${input({ name: "phone", label: "رقم الهاتف (اسم المستخدم)", type: "tel", inputmode: "tel", dir: "ltr", value: v.phone, required: true, error: errors.phone, hint: phoneExample("رقم نقال جزائري، مثال:") })}
    ${input({ name: "note", label: "ملاحظة خاصة بك (اختيارية)", value: v.note, maxlength: 300, hint: "لا يراها الولي." })}
  </section>
  <section class="card form-card">
    <h2>الأبناء</h2>
    ${alertBox(errors.children)}
    <p class="muted small">املأ خانات الأبناء المطلوبين فقط. يمكنك إضافة ابن آخر لاحقًا من صفحة العائلة.</p>
    <div class="child-slots">
    ${slots.map(
      (c, i) => html`<fieldset class="child-slot">
      <legend>الابن ${String(i + 1)}</legend>
      ${input({ name: `child_name_${i + 1}`, label: "الاسم الكامل", value: c.name, error: errors[`child_${i + 1}`], maxlength: 80 })}
      ${select({ name: `child_level_${i + 1}`, label: "المستوى", options: LEVEL_OPTIONS, value: c.level, placeholder: "اختر المستوى" })}
      ${select({ name: `child_package_${i + 1}`, label: "الاشتراك (يُفعَّل فورًا)", options: levelPackageOptions(terms), value: c.package || defaultPackage(terms), error: errors[`package_${i + 1}`] })}
    </fieldset>`,
    )}
    </div>
  </section>
  <section class="card form-card">
    <h2>الدفع</h2>
    ${paymentFields({ amount: v.amount, receipt: v.receipt }, errors)}
  </section>
  <div class="form-actions">
    <button class="btn btn-primary" type="submit">${icon("userPlus")}إنشاء الحساب</button>
    <a class="btn btn-secondary" href="/admin/families">إلغاء</a>
  </div>
</form>`,
  );
}

// ---------- بيانات الدخول (تظهر مرة واحدة) ----------

export function credentialsPage(
  view: View,
  o: { account: Account; password: string; loginUrl: string; created: boolean },
): string {
  const { account } = o;
  const message =
    `السلام عليكم ${account.name}،\n` +
    (o.created
      ? "تم إنشاء حساب عائلتكم على منصة الأستاذ زين الدين للرياضيات.\n"
      : "هذه كلمة مرور مؤقتة جديدة لحساب عائلتكم على منصة الأستاذ زين الدين للرياضيات.\n") +
    `رابط الدخول: ${o.loginUrl}\n` +
    `رقم الهاتف: ${account.phone}\n` +
    `كلمة المرور المؤقتة: ${o.password}\n` +
    "سيُطلب منكم اختيار كلمة مرور جديدة عند الدخول.";
  const wa = `https://wa.me/${whatsappNumber(account.phone)}?text=${encodeURIComponent(message)}`;
  return adminLayout(
    view,
    o.created ? "تم إنشاء الحساب" : "كلمة مرور مؤقتة جديدة",
    "families",
    html`<section class="card hero hero-compact">
  <span class="icon-box icon-box-lg icon-box-success">${icon("check")}</span>
  <h1>${o.created ? "تم إنشاء حساب العائلة" : "كلمة مرور مؤقتة جديدة"}</h1>
  <p class="muted">${account.name} · <bdi dir="ltr">${formatPhone(account.phone)}</bdi></p>
</section>
<section class="card form-card">
  <h2>أرسل بيانات الدخول للولي</h2>
  ${alertBox("كلمة المرور المؤقتة تظهر هنا مرة واحدة فقط ولا تُحفظ في المنصة. أرسلها الآن.", "info")}
  <dl class="creds">
    <div><dt>رقم الهاتف</dt><dd dir="ltr">${account.phone}</dd></div>
    <div><dt>كلمة المرور المؤقتة</dt><dd dir="ltr" class="creds-password" data-copy-source="password">${o.password}</dd></div>
  </dl>
  <div class="actions">
    <a class="btn btn-primary" href="${wa}" target="_blank" rel="noopener">${icon("chat")}إرسال عبر واتساب</a>
    <button class="btn btn-secondary" type="button" data-copy="password" hidden>${icon("copy")}<span>نسخ كلمة المرور</span></button>
    <a class="btn btn-secondary" href="/admin/families/${String(account.id)}">صفحة العائلة ${icon("arrowLeft")}</a>
  </div>
</section>`,
    ["/admin.js"],
  );
}

// ---------- صفحة العائلة ----------

function subPill(st: SubStatus): Raw {
  const cls = statusClass(st);
  return html`<span class="pill pill-wrap ${cls}">${statusLabel(st)}</span>`;
}

function packageOptions(student: Student, programs: Program[], t: TermInfo) {
  const level = programs.find((p) => p.slug === student.level);
  const out: { value: string; label: string }[] = [{ value: "", label: "—" }];
  if (level) {
    for (const opt of levelPackageOptions(t).filter((x) => x.value !== "none")) out.push({ value: `${level.slug}:${opt.value}`, label: `${level.short}: ${opt.label}` });
  }
  for (const c of programs.filter((p) => p.kind === "course")) out.push({ value: `${c.slug}:course`, label: `${c.title}: سنة من اليوم` });
  return out;
}

function payState(x: Subscription, now: number): Raw {
  if (x.payment_id !== null) return html`<span class="pill pill-success">مدفوع${x.amount ? html` · ${formatAmount(x.amount)}` : ""}</span>`;
  if (x.pay_due_at === null) return html``;
  return counts(x, now)
    ? html`<span class="pill pill-warning">بانتظار الدفع حتى ${formatDate(x.pay_due_at)}</span>`
    : html`<span class="pill pill-danger">متوقف: انتهت مهلة الدفع</span>`;
}

function subscriptionsSection(o: {
  students: Student[];
  subs: Subscription[];
  programs: Program[];
  payments: Payment[];
  settings: Settings;
  now: number;
  errors?: Record<string, string>;
  values?: Record<string, string>;
}): Raw {
  const e = o.errors ?? {};
  const v = o.values ?? {};
  const kids = o.students.filter((s) => s.status === "active");
  const title = (slug: string) => o.programs.find((p) => p.slug === slug)?.title ?? slug;
  const name = (id: number) => o.students.find((s) => s.id === id)?.name ?? "";
  const unpaid = o.subs.filter((x) => x.payment_id === null && x.pay_due_at !== null && x.ends_at >= o.now);
  return html`<section class="card form-card" aria-labelledby="subs-title" id="subs">
    <h2 id="subs-title">الاشتراكات والدفع</h2>
    ${kids.length ? "" : html`<p class="muted">لا يوجد ابن نشط.</p>`}
    ${kids.map((s) => {
      const mine = o.subs.filter((x) => x.student_id === s.id);
      const programsHeld = [...new Set(mine.map((x) => x.program_slug))];
      return html`<div class="sub-block">
      <h3>${s.name}</h3>
      <p class="sub-status">${subPill(subscriptionStatus(mine, s.level, o.now))}</p>
      ${programsHeld.filter((p) => p !== s.level).map((p) => html`<p class="sub-status"><span class="muted">${title(p)}:</span> ${subPill(subscriptionStatus(mine, p, o.now))}</p>`)}
      ${
        mine.length
          ? html`<ul class="sub-list">${mine.map(
              (x) => html`<li>
        <span><strong>${title(x.program_slug)}</strong> · ${KIND_TITLES[x.kind]}<small>${formatDate(x.starts_at)} ← ${formatDate(x.ends_at)}</small>${payState(x, o.now)}</span>
        <details class="sub-del"><summary class="btn-link btn-danger-link" aria-label="حذف هذا الاشتراك">${icon("trash", "icon icon-sm")}</summary>
          <form method="post" action="/admin/subscriptions/${String(x.id)}/delete" class="form">
            <label class="check"><input type="checkbox" name="confirm" value="1" required> أؤكد حذف هذا الاشتراك (للأخطاء فقط)</label>
            <button class="btn btn-danger btn-xs" type="submit">حذف</button>
          </form>
        </details>
      </li>`,
            )}</ul>`
          : ""
      }
    </div>`;
    })}

    ${
      unpaid.length
        ? html`<form method="post" action="/admin/families/${String(o.students[0]?.account_id ?? 0)}/payments" class="form sub-form pay-form" novalidate>
      <h3>تسجيل دفعة</h3>
      ${alertBox(e.pay_form)}
      <fieldset class="check-list"><legend class="sr-only">الاشتراكات التي تغطيها الدفعة</legend>
        ${unpaid.map(
          (x) => html`<label class="check"><input type="checkbox" name="sub_${String(x.id)}" value="1"${v[`sub_${x.id}`] === "0" ? "" : html` checked`}> ${name(x.student_id)} · ${title(x.program_slug)} · ${KIND_TITLES[x.kind]}</label>`,
        )}
      </fieldset>
      ${paymentFields({ amount: v.pay_amount, receipt: v.pay_receipt }, { amount: e.pay_amount ?? "" }, "f-pay")}
      <button class="btn btn-primary btn-sm" type="submit">${icon("check")}تسجيل الدفعة</button>
    </form>`
        : ""
    }

    ${
      kids.length
        ? html`<form method="post" action="/admin/families/${String(kids[0]!.account_id)}/activate" class="form sub-form" novalidate>
      <h3>تفعيل أو تجديد</h3>
      ${alertBox(e.activate)}
      ${kids.map((s) =>
        select({ name: `package_${s.id}`, id: `f-package-${s.id}`, label: s.name, options: packageOptions(s, o.programs, o), value: v[`package_${s.id}`] ?? "", error: e[`package_${s.id}`] }),
      )}
      ${paymentFields({ amount: v.act_amount, receipt: v.act_receipt }, { amount: e.act_amount ?? "" }, "f-act")}
      <button class="btn btn-primary btn-sm" type="submit">${icon("check")}تفعيل</button>
    </form>`
        : ""
    }

    ${
      o.payments.length
        ? html`<div class="pay-history"><h3>الدفعات</h3><ul class="sub-list">${o.payments.map(
            (p) => html`<li><span><strong>${formatAmount(p.amount)}</strong><small>${formatDate(p.paid_at)}${p.receipt ? html` · وصل <bdi>${p.receipt}</bdi>` : ""}</small></span></li>`,
          )}</ul></div>`
        : ""
    }
  </section>`;
}

const DONE_MESSAGES: Record<string, string> = {
  edit: "حُفظت بيانات الولي.",
  child: "أُضيف الابن.",
  "child-edit": "حُفظت بيانات الابن.",
  unlock: "رُفع القفل. يمكن للولي الدخول الآن.",
  disabled: "أُوقف الحساب وخرج من كل الأجهزة.",
  enabled: "فُعّل الحساب.",
  "device-approved": "تمت الموافقة على الجهاز. يستطيع الولي الدخول منه الآن.",
  "device-removed": "أُزيل الجهاز وخرج من الحساب.",
  "devices-reset": "حُذفت كل الأجهزة. أول جهاز يدخل منه الولي سيُعتمد تلقائيًا.",
  "pins-cleared": "أُزيلت رموز كل الملفات.",
  "sub-activated": "فُعّل الاشتراك. المحتوى مفتوح للابن الآن.",
  "paid": "سُجّلت الدفعة.",
  "sub-deleted": "حُذف الاشتراك.",
};

export function familyPage(
  view: View,
  o: {
    account: Account;
    students: Student[];
    devices: Device[];
    subs: Subscription[];
    programs: Program[];
    payments: Payment[];
    settings: Settings;
    now: number;
    done?: string | null;
    errors?: Record<string, string>;
    values?: Record<string, string>;
  },
): string {
  const { account, students } = o;
  const e = o.errors ?? {};
  const v = o.values ?? {};
  const state = familyState(account, o.now);
  const id = String(account.id);
  return adminLayout(
    view,
    account.name,
    "families",
    html`<nav class="crumbs" aria-label="مسار التصفح"><a href="/admin/families">العائلات</a><span aria-hidden="true">/</span><span aria-current="page">${account.name}</span></nav>
${alertBox(o.done ? DONE_MESSAGES[o.done] : null, "success")}
${alertBox(Object.keys(e).length ? "راجع الخانات المشار إليها." : null)}
<section class="card hero hero-compact">
  <div class="family-head">
    <span class="avatar avatar-lg">${account.name.trim().charAt(0)}</span>
    <div>
      <h1>${account.name}</h1>
      <p class="muted"><bdi dir="ltr">${formatPhone(account.phone)}</bdi> ${statePill(state)}</p>
      ${account.note ? html`<p class="muted small">${icon("info", "icon icon-sm")} ${account.note}</p>` : ""}
    </div>
  </div>
</section>

<div class="admin-grid">
  <section class="card form-card" aria-labelledby="kids">
    <h2 id="kids">الأبناء</h2>
    ${
      students.length
        ? html`<ul class="kid-list">${students.map(
            (s) => html`<li>
      <details class="kid">
        <summary>
          <span class="avatar avatar-sm">${s.name.trim().charAt(0)}</span>
          <span class="kid-main"><span class="kid-name">${s.name}</span><span class="item-kind">${levelTitle(s.level)}${s.status === "disabled" ? " · موقوف" : ""}${s.pin_hash ? " · له رمز" : ""}</span></span>
          <span class="kid-edit">${icon("pencil", "icon icon-sm")}تعديل</span>
        </summary>
        <form method="post" action="/admin/students/${String(s.id)}/edit" class="form" novalidate>
          ${input({ name: "name", id: `f-kidname-${s.id}`, label: "الاسم الكامل", value: s.name, required: true, maxlength: 80 })}
          ${select({ name: "level", id: `f-kidlevel-${s.id}`, label: "المستوى", options: LEVEL_OPTIONS, value: s.level })}
          ${select({ name: "status", id: `f-kidstatus-${s.id}`, label: "الحالة", options: [{ value: "active", label: "نشط" }, { value: "disabled", label: "موقوف" }], value: s.status })}
          <button class="btn btn-primary btn-sm" type="submit">حفظ</button>
        </form>
      </details>
    </li>`,
          )}</ul>`
        : html`<p class="muted">لا يوجد أبناء بعد.</p>`
    }
    <details class="add-child"${e.child_name ? html` open` : ""}>
      <summary class="btn btn-secondary btn-sm">${icon("userPlus", "icon icon-sm")}إضافة ابن</summary>
      <form method="post" action="/admin/families/${id}/children" class="form" novalidate>
        ${input({ name: "child_name", label: "الاسم الكامل", value: v.child_name, required: true, error: e.child_name, maxlength: 80 })}
        ${select({ name: "child_level", label: "المستوى", options: LEVEL_OPTIONS, value: v.child_level, placeholder: "اختر المستوى", error: e.child_level })}
        ${select({ name: "child_package", label: "الاشتراك (يُفعَّل فورًا)", options: levelPackageOptions(o), value: v.child_package ?? defaultPackage(o), error: e.child_package })}
        ${paymentFields({ amount: v.child_amount, receipt: v.child_receipt }, { amount: e.child_amount ?? "" }, "f-child")}
        <button class="btn btn-primary btn-sm" type="submit">إضافة</button>
      </form>
    </details>
  </section>

  <section class="card form-card" aria-labelledby="parent">
    <h2 id="parent">بيانات الولي</h2>
    <form method="post" action="/admin/families/${id}/edit" class="form" novalidate>
      ${input({ name: "name", label: "اسم الولي", value: v.name ?? account.name, required: true, error: e.name, maxlength: 80 })}
      ${input({ name: "phone", label: "رقم الهاتف (اسم المستخدم)", type: "tel", inputmode: "tel", dir: "ltr", value: v.phone ?? account.phone, required: true, error: e.phone })}
      ${input({ name: "note", label: "ملاحظة خاصة بك", value: v.note ?? account.note ?? "", maxlength: 300 })}
      <button class="btn btn-primary btn-sm" type="submit">حفظ</button>
    </form>
  </section>

  ${subscriptionsSection(o)}

  <section class="card form-card" aria-labelledby="devices">
    <h2 id="devices">الأجهزة</h2>
    ${
      o.devices.length
        ? html`<ul class="device-list device-list-plain">${o.devices.map(
            (d) => html`<li>
      <span class="icon-box icon-box-sm icon-box-soft">${icon("phone")}</span>
      <span class="device-main"><strong>${d.label ?? "جهاز"}</strong><small>${d.status === "approved" ? html`معتمد${d.last_used_at ? html` · آخر استعمال ${when(d.last_used_at)}` : ""}` : html`بانتظار موافقتك · ${when(d.created_at)}`}</small></span>
      <span class="device-actions">
        ${d.status === "pending" ? deviceAction(d.id, "approve", "family", "موافقة", "btn btn-primary btn-sm") : ""}
        ${deviceAction(d.id, "remove", "family", d.status === "pending" ? "رفض" : "إزالة", "btn btn-secondary btn-sm")}
      </span>
    </li>`,
          )}</ul>`
        : html`<p class="muted">لم يدخل الولي من أي جهاز بعد. أول جهاز يدخل منه يُعتمد تلقائيًا.</p>`
    }
    <div class="action-list">
      <form method="post" action="/admin/families/${id}/reset-devices">
        <button class="action-row" type="submit">${icon("phone")}<span><strong>إعادة ضبط الأجهزة</strong><small>إذا غيّر الولي هاتفه. تُحذف كل الأجهزة، ويُعتمد أول جهاز يدخل منه بعدها.</small></span></button>
      </form>
      ${
        account.parent_pin_hash || students.some((s) => s.pin_hash)
          ? html`<form method="post" action="/admin/families/${id}/clear-pins">
        <button class="action-row" type="submit">${icon("unlock")}<span><strong>مسح رموز الملفات</strong><small>إذا نسيت العائلة رمز أحد الملفات. تُزال الرموز الأربعة الأرقام كلها.</small></span></button>
      </form>`
          : ""
      }
    </div>
  </section>

  <section class="card form-card" aria-labelledby="access">
    <h2 id="access">الدخول</h2>
    <div class="action-list">
      <form method="post" action="/admin/families/${id}/reset-password">
        <button class="action-row" type="submit">${icon("key")}<span><strong>كلمة مرور مؤقتة جديدة</strong><small>إذا نسي الولي كلمة المرور. يخرج الحساب من كل الأجهزة.</small></span></button>
      </form>
      ${
        state === "locked"
          ? html`<form method="post" action="/admin/families/${id}/unlock">
        <button class="action-row" type="submit">${icon("unlock")}<span><strong>رفع القفل الآن</strong><small>أُقفل الدخول بعد محاولات خاطئة.</small></span></button>
      </form>`
          : ""
      }
      <form method="post" action="/admin/families/${id}/status">
        ${
          account.status === "active"
            ? html`<input type="hidden" name="status" value="disabled"><button class="action-row action-danger" type="submit">${icon("ban")}<span><strong>إيقاف الحساب</strong><small>لا يستطيع الولي ولا الأبناء الدخول حتى تعيد تفعيله.</small></span></button>`
            : html`<input type="hidden" name="status" value="active"><button class="action-row" type="submit">${icon("check")}<span><strong>تفعيل الحساب</strong><small>يستطيع الولي الدخول من جديد.</small></span></button>`
        }
      </form>
    </div>
  </section>
</div>`,
  );
}
