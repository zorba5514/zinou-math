// مسارات لوحة تحكم الأستاذ.

import { audit, type Account, type Device, type Student } from "./db.ts";
import { getSettings, ENDING_SOON_DAYS, type SubKind, type Subscription } from "./subscriptions.ts";
import { activate, parseAmount, prepareItems, recordPayment, unpaidSubscriptions, type PackageItem, type Payment } from "./payments.ts";
import type { Program } from "./content.ts";
import { endOtherSessions, passwordIterations } from "./auth.ts";
import { hashPassword, temporaryPassword } from "./crypto.ts";
import { field, page, readForm, redirect } from "./http.ts";
import { normalizePhone } from "./phone.ts";
import { isLevel } from "./content.ts";
import {
  CHILD_SLOTS,
  credentialsPage,
  dashboardPage,
  familiesPage,
  familyPage,
  newFamilyPage,
  type FamilyRow,
  type NewFamilyValues,
  type PendingDevice,
  type EndingSoon,
} from "./admin-pages.ts";
import { notFoundPage } from "./pages.ts";
import { handleContentRoutes } from "./content-admin-routes.ts";
import { handleSettings } from "./settings-admin.ts";
import { handleQuizAdmin, pendingGrading } from "./quiz-admin.ts";
import type { Ctx } from "./auth-routes.ts";

function validName(name: string): boolean {
  return name.length >= 2 && name.length <= 80;
}

function validLevel(slug: string): boolean {
  return isLevel(slug);
}

export async function handleAdminRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  if (path !== "/admin" && !path.startsWith("/admin/")) return null;
  if (!ctx.user) return redirect(`/login?next=${encodeURIComponent(path)}`);
  // غير الأستاذ لا يرى حتى وجود هذه الصفحات
  if (ctx.user.account.role !== "admin") return page(notFoundPage(ctx.view), 404);

  const content = (await handleContentRoutes(ctx)) ?? (await handleSettings(ctx)) ?? (await handleQuizAdmin(ctx));
  if (content) return content;

  if (path === "/admin" && method === "GET") return dashboard(ctx);
  if (path === "/admin/families" && method === "GET") return familiesList(ctx);
  if (path === "/admin/families/new") {
    return method === "POST" ? createFamily(ctx) : page(newFamilyPage(ctx.view, emptyFamily(), { settings: await getSettings(ctx.env.DB), now: ctx.now }));
  }

  const fam = /^\/admin\/families\/(\d+)(?:\/([a-z-]+))?$/.exec(path);
  if (fam) {
    const account = await loadFamily(ctx, Number(fam[1]));
    if (!account) return page(notFoundPage(ctx.view), 404);
    const action = fam[2];
    if (!action && method === "GET") return showFamily(ctx, account);
    if (method === "POST") {
      if (action === "edit") return editFamily(ctx, account);
      if (action === "children") return addChild(ctx, account);
      if (action === "reset-password") return resetPassword(ctx, account);
      if (action === "unlock") return unlock(ctx, account);
      if (action === "status") return setStatus(ctx, account);
      if (action === "reset-devices") return resetDevices(ctx, account);
      if (action === "clear-pins") return clearPins(ctx, account);
      if (action === "activate") return activateFamily(ctx, account);
      if (action === "payments") return payFamily(ctx, account);
    }
  }

  const dev = /^\/admin\/devices\/(\d+)\/(approve|remove)$/.exec(path);
  if (dev && method === "POST") return deviceAction(ctx, Number(dev[1]), dev[2] as "approve" | "remove");

  const kid = /^\/admin\/students\/(\d+)\/edit$/.exec(path);
  if (kid && method === "POST") return editStudent(ctx, Number(kid[1]));

  const removeSub = /^\/admin\/subscriptions\/(\d+)\/delete$/.exec(path);
  if (removeSub && method === "POST") return deleteSubscription(ctx, Number(removeSub[1]));

  return page(notFoundPage(ctx.view), 404);
}

async function loadFamily(ctx: Ctx, id: number): Promise<Account | null> {
  return ctx.env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND role = 'parent'").bind(id).first<Account>();
}

async function loadStudents(ctx: Ctx, accountId: number): Promise<Student[]> {
  const r = await ctx.env.DB.prepare("SELECT * FROM students WHERE account_id = ? ORDER BY id").bind(accountId).all<Student>();
  return r.results;
}

function adminId(ctx: Ctx): number {
  return ctx.user?.account.id ?? 0;
}

// ---------- لوحة التحكم ----------

async function dashboard(ctx: Ctx): Promise<Response> {
  const db = ctx.env.DB;
  const count = async (sql: string, ...args: unknown[]) =>
    (await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
  const recent = await db
    .prepare(
      `SELECT l.at, l.action, l.detail, a.name FROM audit_log l
       LEFT JOIN accounts a ON a.id = CAST(substr(l.target, 9) AS INTEGER) AND l.target LIKE 'account:%'
       WHERE l.action NOT IN ('login', 'logout', 'setup.failed')
       ORDER BY l.at DESC, l.id DESC LIMIT 8`,
    )
    .all<{ at: number; action: string; detail: string | null; name: string | null }>();
  return page(
    dashboardPage(ctx.view, {
      families: await count("SELECT COUNT(*) AS n FROM accounts WHERE role = 'parent'"),
      students: await count("SELECT COUNT(*) AS n FROM students s JOIN accounts a ON a.id = s.account_id WHERE s.status = 'active' AND a.role = 'parent'"),
      locked: await count("SELECT COUNT(*) AS n FROM accounts WHERE role = 'parent' AND locked_until > ?", ctx.now),
      pending: await count("SELECT COUNT(*) AS n FROM accounts WHERE role = 'parent' AND must_change_password = 1 AND status = 'active'"),
      devices: (
        await db
          .prepare(
            `SELECT d.id, d.label, d.created_at, d.account_id, a.name, a.phone FROM devices d
             JOIN accounts a ON a.id = d.account_id
             WHERE d.status = 'pending' AND a.role = 'parent' AND a.status = 'active'
             ORDER BY d.created_at DESC LIMIT 50`,
          )
          .all<PendingDevice>()
      ).results,
      ending: await endingSoon(ctx),
      grading: await pendingGrading(ctx),
      unpaid: await unpaidSubscriptions(ctx.env.DB, ctx.now),
      recent: recent.results,
    }),
  );
}

// ---------- قائمة العائلات ----------

async function familiesList(ctx: Ctx): Promise<Response> {
  const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const db = ctx.env.DB;
  let accounts: Account[];
  if (q) {
    const phone = normalizePhone(q);
    const digits = q.replace(/\D/g, "");
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    accounts = (
      await db
        .prepare(
          `SELECT DISTINCT a.* FROM accounts a LEFT JOIN students s ON s.account_id = a.id
           WHERE a.role = 'parent' AND (a.name LIKE ?1 ESCAPE '\\' OR s.name LIKE ?1 ESCAPE '\\' OR a.phone = ?2 OR (length(?3) >= 4 AND a.phone LIKE '%' || ?3 || '%'))
           ORDER BY a.created_at DESC LIMIT 200`,
        )
        .bind(like, phone ?? "", digits)
        .all<Account>()
    ).results;
  } else {
    accounts = (
      await db.prepare("SELECT * FROM accounts WHERE role = 'parent' ORDER BY created_at DESC LIMIT 200").all<Account>()
    ).results;
  }
  const rows: FamilyRow[] = [];
  if (accounts.length) {
    const ids = accounts.map((a) => a.id);
    const kids = await db
      .prepare(`SELECT account_id, name FROM students WHERE status = 'active' AND account_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`)
      .bind(...ids)
      .all<{ account_id: number; name: string }>();
    for (const account of accounts) {
      rows.push({ account, children: kids.results.filter((k) => k.account_id === account.id).map((k) => k.name) });
    }
  }
  return page(familiesPage(ctx.view, rows, q, ctx.now));
}

// ---------- إنشاء عائلة ----------

function emptyFamily(): NewFamilyValues {
  return { name: "", phone: "", note: "", children: [], amount: "", receipt: "" };
}

const LEVEL_KINDS = ["term1", "term2", "term3", "year"];

async function createFamily(ctx: Ctx): Promise<Response> {
  const form = await readForm(ctx.request);
  const db = ctx.env.DB;
  const settings = await getSettings(db);
  const v: NewFamilyValues = {
    name: field(form, "name"),
    phone: field(form, "phone"),
    note: field(form, "note").slice(0, 300),
    children: Array.from({ length: CHILD_SLOTS }, (_, i) => ({
      name: field(form, `child_name_${i + 1}`),
      level: field(form, `child_level_${i + 1}`),
      package: field(form, `child_package_${i + 1}`) || "none",
    })),
    amount: field(form, "amount"),
    receipt: field(form, "receipt").slice(0, 60),
  };
  const errors: Record<string, string> = {};
  if (!validName(v.name)) errors.name = "اكتب اسم الولي (حرفان على الأقل).";
  const phone = normalizePhone(v.phone);
  if (!phone) errors.phone = "رقم الهاتف غير صحيح. يجب أن يتكون من 10 أرقام ويبدأ بـ 05 أو 06 أو 07.";
  else if (await db.prepare("SELECT id FROM accounts WHERE phone = ?").bind(phone).first()) {
    errors.phone = "هذا الرقم مسجل لعائلة أخرى. ابحث عنه في قائمة العائلات.";
  }
  const kids = v.children.map((c, i) => ({ ...c, slot: i + 1 })).filter((c) => c.name || c.level);
  for (const c of kids) {
    if (!validName(c.name)) errors[`child_${c.slot}`] = "اكتب اسم الابن.";
    else if (!validLevel(c.level)) errors[`child_${c.slot}`] = "اختر مستوى الابن.";
    else if (c.package !== "none" && !LEVEL_KINDS.includes(c.package)) errors[`package_${c.slot}`] = "اختر الاشتراك.";
  }
  if (!kids.length) errors.children = "أضف ابنًا واحدًا على الأقل.";
  const amount = parseAmount(v.amount);
  if (Number.isNaN(amount)) errors.amount = "اكتب المبلغ بالأرقام فقط، مثل 4000.";
  const toActivate = kids.filter((c) => c.package !== "none");
  if (amount && !toActivate.length) errors.amount = "لا يوجد اشتراك ليُسجَّل له المبلغ. اختر اشتراكًا لابن واحد على الأقل.";
  // تواريخ الباقات تُتحقق قبل إنشاء أي شيء
  const prepared = prepareItems(
    toActivate.map((c) => ({ studentId: c.slot, studentName: c.name, programSlug: c.level, kind: c.package as SubKind })),
    settings,
    ctx.now,
  );
  if (!prepared.ok) errors[`package_${prepared.studentId}`] = prepared.error;
  const terms = { settings, now: ctx.now };
  if (Object.keys(errors).length || !phone || !prepared.ok) return page(newFamilyPage(ctx.view, v, terms, errors), 400);

  const password = temporaryPassword();
  const created = await db
    .prepare(
      "INSERT INTO accounts (role, phone, name, password_hash, must_change_password, note, created_at, updated_at) VALUES ('parent', ?, ?, ?, 1, ?, ?, ?)",
    )
    .bind(phone, v.name, await hashPassword(password, passwordIterations(ctx.env)), v.note || null, ctx.now, ctx.now)
    .run();
  const id = Number(created.meta.last_row_id);
  const studentIds: Record<number, number> = {};
  for (const c of kids) {
    const r = await db
      .prepare("INSERT INTO students (account_id, name, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, c.name, c.level, ctx.now, ctx.now)
      .run();
    studentIds[c.slot] = Number(r.meta.last_row_id);
  }
  await audit(db, adminId(ctx), "family.created", `account:${id}`, `${kids.length} ${kids.length === 1 ? "ابن" : "أبناء"}`);
  await activate(db, {
    accountId: id,
    rows: prepared.rows.map((r) => ({ ...r, studentId: studentIds[r.studentId]! })),
    amount: amount || null,
    receipt: v.receipt || null,
    now: ctx.now,
    adminId: adminId(ctx),
  });
  const account = await loadFamily(ctx, id);
  if (!account) return page(notFoundPage(ctx.view), 500);
  return page(credentialsPage(ctx.view, { account, password, loginUrl: `${ctx.url.origin}/login`, created: true }));
}

// ---------- صفحة العائلة وإجراءاتها ----------

const DONE_KEYS = new Set([
  "sub-activated",
  "paid",
  "sub-deleted",
  "edit",
  "child",
  "child-edit",
  "unlock",
  "disabled",
  "enabled",
  "device-approved",
  "device-removed",
  "devices-reset",
  "pins-cleared",
]);

async function familyData(ctx: Ctx, accountId: number) {
  const db = ctx.env.DB;
  const subs = await db
    .prepare("SELECT s.* FROM subscriptions s JOIN students st ON st.id = s.student_id WHERE st.account_id = ? ORDER BY s.ends_at DESC, s.id DESC")
    .bind(accountId)
    .all<Subscription>();
  const programs = await db.prepare("SELECT * FROM programs ORDER BY position, slug").all<Program>();
  const payments = await db.prepare("SELECT * FROM payments WHERE account_id = ? ORDER BY paid_at DESC, id DESC").bind(accountId).all<Payment>();
  return {
    students: await loadStudents(ctx, accountId),
    devices: await loadDevices(ctx, accountId),
    subs: subs.results,
    programs: programs.results,
    payments: payments.results,
    settings: await getSettings(db),
  };
}

async function loadDevices(ctx: Ctx, accountId: number): Promise<Device[]> {
  const r = await ctx.env.DB
    .prepare("SELECT * FROM devices WHERE account_id = ? AND status != 'revoked' ORDER BY status DESC, id")
    .bind(accountId)
    .all<Device>();
  return r.results;
}

async function showFamily(ctx: Ctx, account: Account): Promise<Response> {
  const done = ctx.url.searchParams.get("done");
  return page(
    familyPage(ctx.view, {
      account,
      ...(await familyData(ctx, account.id)),
      now: ctx.now,
      done: done && DONE_KEYS.has(done) ? done : null,
    }),
  );
}

async function editFamily(ctx: Ctx, account: Account): Promise<Response> {
  const form = await readForm(ctx.request);
  const values = { name: field(form, "name"), phone: field(form, "phone"), note: field(form, "note").slice(0, 300) };
  const errors: Record<string, string> = {};
  if (!validName(values.name)) errors.name = "اكتب اسم الولي (حرفان على الأقل).";
  const phone = normalizePhone(values.phone);
  if (!phone) errors.phone = "رقم الهاتف غير صحيح.";
  else if (await ctx.env.DB.prepare("SELECT id FROM accounts WHERE phone = ? AND id != ?").bind(phone, account.id).first()) {
    errors.phone = "هذا الرقم مسجل لحساب آخر.";
  }
  if (Object.keys(errors).length || !phone) {
    return page(familyPage(ctx.view, { account, ...(await familyData(ctx, account.id)), now: ctx.now, errors, values }), 400);
  }
  await ctx.env.DB
    .prepare("UPDATE accounts SET name = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(values.name, phone, values.note || null, ctx.now, account.id)
    .run();
  await audit(ctx.env.DB, adminId(ctx), "family.updated", `account:${account.id}`, phone !== account.phone ? "تغيير رقم الهاتف" : null);
  return redirect(`/admin/families/${account.id}?done=edit`);
}

async function addChild(ctx: Ctx, account: Account): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const values = {
    child_name: field(form, "child_name"),
    child_level: field(form, "child_level"),
    child_package: field(form, "child_package") || "none",
    child_amount: field(form, "amount"),
    child_receipt: field(form, "receipt").slice(0, 60),
  };
  const errors: Record<string, string> = {};
  if (!validName(values.child_name)) errors.child_name = "اكتب اسم الابن.";
  if (!validLevel(values.child_level)) errors.child_level = "اختر المستوى.";
  if (values.child_package !== "none" && !LEVEL_KINDS.includes(values.child_package)) errors.child_package = "اختر الاشتراك.";
  const amount = parseAmount(values.child_amount);
  if (Number.isNaN(amount)) errors.child_amount = "اكتب المبلغ بالأرقام فقط، مثل 4000.";
  if (amount && values.child_package === "none") errors.child_amount = "اختر اشتراكًا ليُسجَّل له المبلغ.";
  const settings = await getSettings(db);
  const prepared = prepareItems(
    values.child_package === "none" ? [] : [{ studentId: 0, studentName: values.child_name, programSlug: values.child_level, kind: values.child_package as SubKind }],
    settings,
    ctx.now,
  );
  if (!prepared.ok) errors.child_package = prepared.error;
  if (Object.keys(errors).length || !prepared.ok) {
    return page(familyPage(ctx.view, { account, ...(await familyData(ctx, account.id)), now: ctx.now, errors, values }), 400);
  }
  const r = await db
    .prepare("INSERT INTO students (account_id, name, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(account.id, values.child_name, values.child_level, ctx.now, ctx.now)
    .run();
  const studentId = Number(r.meta.last_row_id);
  await audit(db, adminId(ctx), "student.added", `account:${account.id}`, values.child_name);
  await activate(db, {
    accountId: account.id,
    rows: prepared.rows.map((row) => ({ ...row, studentId })),
    amount: amount || null,
    receipt: values.child_receipt || null,
    now: ctx.now,
    adminId: adminId(ctx),
  });
  return redirect(`/admin/families/${account.id}?done=child`);
}

async function editStudent(ctx: Ctx, studentId: number): Promise<Response> {
  const student = await ctx.env.DB
    .prepare("SELECT s.* FROM students s JOIN accounts a ON a.id = s.account_id WHERE s.id = ? AND a.role = 'parent'")
    .bind(studentId)
    .first<Student>();
  if (!student) return page(notFoundPage(ctx.view), 404);
  const form = await readForm(ctx.request);
  const name = field(form, "name");
  const level = field(form, "level");
  const status = field(form, "status") === "disabled" ? "disabled" : "active";
  if (!validName(name) || !validLevel(level)) return redirect(`/admin/families/${student.account_id}`);
  await ctx.env.DB
    .prepare("UPDATE students SET name = ?, level = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind(name, level, status, ctx.now, studentId)
    .run();
  await audit(ctx.env.DB, adminId(ctx), "student.updated", `account:${student.account_id}`, name);
  return redirect(`/admin/families/${student.account_id}?done=child-edit`);
}

async function resetPassword(ctx: Ctx, account: Account): Promise<Response> {
  const password = temporaryPassword();
  await ctx.env.DB
    .prepare("UPDATE accounts SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(password, passwordIterations(ctx.env)), ctx.now, account.id)
    .run();
  await endOtherSessions(ctx.env.DB, account.id, null);
  await audit(ctx.env.DB, adminId(ctx), "family.password_reset", `account:${account.id}`);
  const fresh = (await loadFamily(ctx, account.id)) ?? account;
  return page(credentialsPage(ctx.view, { account: fresh, password, loginUrl: `${ctx.url.origin}/login`, created: false }));
}

async function unlock(ctx: Ctx, account: Account): Promise<Response> {
  await ctx.env.DB
    .prepare("UPDATE accounts SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
    .bind(ctx.now, account.id)
    .run();
  await audit(ctx.env.DB, adminId(ctx), "family.unlocked", `account:${account.id}`);
  return redirect(`/admin/families/${account.id}?done=unlock`);
}

async function setStatus(ctx: Ctx, account: Account): Promise<Response> {
  const form = await readForm(ctx.request);
  const status = field(form, "status") === "disabled" ? "disabled" : "active";
  await ctx.env.DB.prepare("UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?").bind(status, ctx.now, account.id).run();
  if (status === "disabled") await endOtherSessions(ctx.env.DB, account.id, null);
  await audit(ctx.env.DB, adminId(ctx), status === "disabled" ? "family.disabled" : "family.enabled", `account:${account.id}`);
  return redirect(`/admin/families/${account.id}?done=${status === "disabled" ? "disabled" : "enabled"}`);
}

// ---------- الأجهزة ورموز الملفات ----------

async function deviceAction(ctx: Ctx, deviceId: number, action: "approve" | "remove"): Promise<Response> {
  const db = ctx.env.DB;
  const device = await db
    .prepare("SELECT d.* FROM devices d JOIN accounts a ON a.id = d.account_id WHERE d.id = ? AND a.role = 'parent'")
    .bind(deviceId)
    .first<Device>();
  if (!device) return page(notFoundPage(ctx.view), 404);
  const form = await readForm(ctx.request);
  const back = field(form, "back") === "dashboard" ? "/admin" : `/admin/families/${device.account_id}`;
  if (action === "approve") {
    await db.prepare("UPDATE devices SET status = 'approved' WHERE id = ?").bind(deviceId).run();
    await audit(db, adminId(ctx), "device.approved", `account:${device.account_id}`, device.label);
    return redirect(back === "/admin" ? back : `${back}?done=device-approved`);
  }
  // الإزالة تحذف الجهاز وكل جلساته: من يستعمله يخرج فورًا، وإن دخل منه لاحقًا ينتظر الموافقة من جديد
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE device_id = ?").bind(deviceId),
    db.prepare("DELETE FROM devices WHERE id = ?").bind(deviceId),
  ]);
  await audit(db, adminId(ctx), "device.removed", `account:${device.account_id}`, device.label);
  return redirect(back === "/admin" ? back : `${back}?done=device-removed`);
}

async function resetDevices(ctx: Ctx, account: Account): Promise<Response> {
  const db = ctx.env.DB;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id),
    db.prepare("DELETE FROM devices WHERE account_id = ?").bind(account.id),
  ]);
  await audit(db, adminId(ctx), "devices.reset", `account:${account.id}`);
  return redirect(`/admin/families/${account.id}?done=devices-reset`);
}

async function clearPins(ctx: Ctx, account: Account): Promise<Response> {
  const db = ctx.env.DB;
  await db.batch([
    db.prepare("UPDATE accounts SET parent_pin_hash = NULL, parent_pin_failed = 0, parent_pin_locked_until = NULL WHERE id = ?").bind(account.id),
    db.prepare("UPDATE students SET pin_hash = NULL, pin_failed = 0, pin_locked_until = NULL WHERE account_id = ?").bind(account.id),
  ]);
  await audit(db, adminId(ctx), "pins.cleared", `account:${account.id}`);
  return redirect(`/admin/families/${account.id}?done=pins-cleared`);
}

// ---------- الاشتراكات ----------

/** تفعيل أو تجديد لعدة أبناء دفعة واحدة، بمبلغ واحد يُقسَّم عليهم. */
async function activateFamily(ctx: Ctx, account: Account): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const students = (await loadStudents(ctx, account.id)).filter((s) => s.status === "active");
  const programs = (await db.prepare("SELECT * FROM programs").all<Program>()).results;
  const values: Record<string, string> = { act_amount: field(form, "amount"), act_receipt: field(form, "receipt").slice(0, 60) };
  const errors: Record<string, string> = {};
  const items: PackageItem[] = [];
  for (const s of students) {
    const value = field(form, `package_${s.id}`);
    values[`package_${s.id}`] = value;
    if (!value) continue;
    // الباقة بصيغة «المستوى:النوع»، مثل 2am:term1 أو olympiad:course
    const [slug = "", kindText = ""] = value.split(":");
    const program = programs.find((p) => p.slug === slug);
    const ok = program?.kind === "course" ? kindText === "course" : program?.slug === s.level && LEVEL_KINDS.includes(kindText);
    if (!program || !ok) errors[`package_${s.id}`] = "اختر الباقة.";
    else items.push({ studentId: s.id, studentName: s.name, programSlug: slug, kind: kindText as SubKind });
  }
  const amount = parseAmount(values.act_amount!);
  if (Number.isNaN(amount)) errors.act_amount = "اكتب المبلغ بالأرقام فقط، مثل 4000.";
  if (!items.length && !Object.keys(errors).length) errors.activate = "اختر باقة لابن واحد على الأقل.";
  const prepared = prepareItems(items, await getSettings(db), ctx.now);
  if (!prepared.ok) errors[`package_${prepared.studentId}`] = prepared.error;
  if (Object.keys(errors).length || !prepared.ok) {
    return page(familyPage(ctx.view, { account, ...(await familyData(ctx, account.id)), now: ctx.now, errors, values }), 400);
  }
  await activate(db, { accountId: account.id, rows: prepared.rows, amount: amount || null, receipt: values.act_receipt || null, now: ctx.now, adminId: adminId(ctx) });
  return redirect(`/admin/families/${account.id}?done=sub-activated#subs`);
}

/** دفعة لاحقة لاشتراكات غير مدفوعة. */
async function payFamily(ctx: Ctx, account: Account): Promise<Response> {
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const data = await familyData(ctx, account.id);
  const unpaid = data.subs.filter((x) => x.payment_id === null && x.pay_due_at !== null);
  const chosen = unpaid.filter((x) => form.get(`sub_${x.id}`) === "1");
  const values: Record<string, string> = { pay_amount: field(form, "amount"), pay_receipt: field(form, "receipt").slice(0, 60) };
  for (const x of unpaid) values[`sub_${x.id}`] = form.get(`sub_${x.id}`) === "1" ? "1" : "0";
  const errors: Record<string, string> = {};
  const amount = parseAmount(values.pay_amount!);
  if (!amount) errors.pay_amount = "اكتب المبلغ المدفوع بالأرقام، مثل 4000.";
  if (!chosen.length) errors.pay_form = "حدّد الاشتراكات التي تغطيها هذه الدفعة.";
  if (Object.keys(errors).length || !amount) {
    return page(familyPage(ctx.view, { account, ...data, now: ctx.now, errors, values }), 400);
  }
  await recordPayment(db, { accountId: account.id, subs: chosen, amount, receipt: values.pay_receipt || null, now: ctx.now, adminId: adminId(ctx) });
  return redirect(`/admin/families/${account.id}?done=paid#subs`);
}

async function deleteSubscription(ctx: Ctx, id: number): Promise<Response> {
  const db = ctx.env.DB;
  const sub = await db
    .prepare("SELECT s.*, st.account_id, st.name FROM subscriptions s JOIN students st ON st.id = s.student_id WHERE s.id = ?")
    .bind(id)
    .first<Subscription & { account_id: number; name: string }>();
  if (!sub) return page(notFoundPage(ctx.view), 404);
  const form = await readForm(ctx.request);
  if (form.get("confirm") !== "1") return redirect(`/admin/families/${sub.account_id}#subs`);
  await db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
  await audit(db, adminId(ctx), "subscription.deleted", `account:${sub.account_id}`, `${sub.name} · ${sub.program_slug}`);
  return redirect(`/admin/families/${sub.account_id}?done=sub-deleted#subs`);
}

export async function endingSoon(ctx: Ctx) {
  const r = await ctx.env.DB
    .prepare(
      `SELECT s.id, s.kind, s.ends_at, s.program_slug, st.name AS student, st.account_id, a.name AS parent, p.title AS program
       FROM subscriptions s
       JOIN students st ON st.id = s.student_id AND st.status = 'active'
       JOIN accounts a ON a.id = st.account_id AND a.status = 'active'
       JOIN programs p ON p.slug = s.program_slug
       WHERE s.ends_at BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM subscriptions n WHERE n.student_id = s.student_id AND n.program_slug = s.program_slug AND n.ends_at > s.ends_at)
       ORDER BY s.ends_at LIMIT 100`,
    )
    .bind(ctx.now, ctx.now + ENDING_SOON_DAYS * 24 * 60 * 60 * 1000)
    .all<EndingSoon>();
  return r.results;
}
