// صفحة الإعدادات في لوحة التحكم: تواريخ نهاية الفصول، ورقم واتساب، ومعلومات الدفع، والأسعار.

import { html } from "./html.ts";
import { icon } from "./icons.ts";
import { alertBox, input, textarea, type View } from "./ui.ts";
import { adminLayout } from "./admin-pages.ts";
import { audit, type D1PreparedStatement } from "./db.ts";
import { field, page, readForm, redirect } from "./http.ts";
import { normalizePhone } from "./phone.ts";
import { SETTING_KEYS, endOfDay, getSettings, type Settings } from "./subscriptions.ts";
import type { Ctx } from "./auth-routes.ts";

export function settingsPage(view: View, values: Settings, o: { done?: boolean; errors?: Record<string, string> } = {}): string {
  const e = o.errors ?? {};
  return adminLayout(
    view,
    "الإعدادات",
    "settings",
    html`<header class="page-head">
  <h1>الإعدادات</h1>
  <p class="muted">ما تكتبه هنا يظهر في صفحة الاشتراك، ويحدد متى تنتهي باقات الفصول.</p>
</header>
${alertBox(o.done ? "حُفظت الإعدادات." : null, "success")}
${alertBox(Object.keys(e).length ? "راجع الخانات المشار إليها." : null)}
<form method="post" action="/admin/settings" class="form settings-form" novalidate>
  <section class="card form-card">
    <h2>${icon("calendar")} نهاية الفصول الدراسية</h2>
    <p class="muted small">باقة الفصل تنتهي في آخر يوم من فصلها، والباقة السنوية في آخر يوم من الفصل الثالث. حدّثها مع بداية كل سنة دراسية.</p>
    <div class="date-grid">
      ${input({ name: "term1_end", label: "نهاية الفصل الأول", type: "date", value: values.term1_end, error: e.term1_end, dir: "ltr" })}
      ${input({ name: "term2_end", label: "نهاية الفصل الثاني", type: "date", value: values.term2_end, error: e.term2_end, dir: "ltr" })}
      ${input({ name: "term3_end", label: "نهاية الفصل الثالث", type: "date", value: values.term3_end, error: e.term3_end, dir: "ltr" })}
    </div>
  </section>
  <section class="card form-card">
    <h2>${icon("card")} الأسعار</h2>
    <p class="muted small">اكتب السعر كما تريد أن يظهر، مثل: 2500 دج.</p>
    ${input({ name: "price_term", label: "باقة الفصل", value: values.price_term, maxlength: 60 })}
    ${input({ name: "price_year", label: "الباقة السنوية", value: values.price_year, maxlength: 60 })}
    ${input({ name: "price_course", label: "الدورة الخاصة (سنة)", value: values.price_course, maxlength: 60 })}
  </section>
  <section class="card form-card">
    <h2>${icon("chat")} التواصل والدفع</h2>
    ${input({ name: "whatsapp", label: "رقم واتساب", type: "tel", dir: "ltr", value: values.whatsapp, error: e.whatsapp, hint: "يظهر زر واتساب في صفحة الاشتراك وفي توصيات الدورات." })}
    ${textarea({ name: "payment_info", label: "طريقة الدفع", value: values.payment_info, rows: 5, maxlength: 1500, hint: "مثل: رقم الحساب البريدي CCP واسم صاحبه، أو الدفع نقدًا في القسم." })}
  </section>
  <button class="btn btn-primary" type="submit">حفظ الإعدادات</button>
</form>`,
  );
}

export async function handleSettings(ctx: Ctx): Promise<Response | null> {
  if (ctx.path !== "/admin/settings") return null;
  const db = ctx.env.DB;
  if (ctx.method === "GET") return page(settingsPage(ctx.view, await getSettings(db), { done: ctx.url.searchParams.get("done") === "1" }));
  if (ctx.method !== "POST") return null;

  const form = await readForm(ctx.request);
  const values: Settings = {};
  for (const key of SETTING_KEYS) values[key] = key === "payment_info" ? (form.get(key) ?? "").trim().slice(0, 1500) : field(form, key).slice(0, 60);
  const errors: Record<string, string> = {};
  for (const key of ["term1_end", "term2_end", "term3_end"] as const) {
    const v = values[key];
    if (!v) continue;
    const t = endOfDay(v);
    if (!t) errors[key] = "تاريخ غير صحيح.";
  }
  if (!errors.term2_end && values.term1_end && values.term2_end && endOfDay(values.term2_end)! <= endOfDay(values.term1_end)!) {
    errors.term2_end = "يجب أن يكون بعد نهاية الفصل الأول.";
  }
  if (!errors.term3_end && values.term2_end && values.term3_end && endOfDay(values.term3_end)! <= endOfDay(values.term2_end)!) {
    errors.term3_end = "يجب أن يكون بعد نهاية الفصل الثاني.";
  }
  if (values.whatsapp) {
    const phone = normalizePhone(values.whatsapp);
    if (!phone) errors.whatsapp = "رقم الهاتف غير صحيح: 10 أرقام يبدأ بـ 05 أو 06 أو 07.";
    else values.whatsapp = phone;
  }
  if (Object.keys(errors).length) return page(settingsPage(ctx.view, values, { errors }), 400);

  const statements: D1PreparedStatement[] = SETTING_KEYS.map((key) =>
    values[key]
      ? db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, values[key], ctx.now)
      : db.prepare("DELETE FROM settings WHERE key = ?").bind(key),
  );
  await db.batch(statements);
  await audit(db, ctx.user?.account.id ?? null, "settings.updated", "settings");
  return redirect("/admin/settings?done=1");
}
