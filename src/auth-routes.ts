// مسارات الدخول والحساب.

import { audit, type Account } from "./db.ts";
import {
  attemptLogin,
  checkSecondFactor,
  createSession,
  deviceStatus,
  endOtherSessions,
  endSession,
  familyDeviceGate,
  passwordIterations,
  registerFailure,
  trustDevice,
  validateNewPassword,
  type Current,
} from "./auth.ts";
import {
  hashPassword,
  newTotpSecret,
  recoveryCode,
  normalizeRecoveryCode,
  safeEqual,
  sha256,
  totpUri,
  verifyPassword,
  verifyTotp,
} from "./crypto.ts";
import { SESSION_COOKIE, clearCookie, field, page, readForm, redirect, safeNext, type Env } from "./http.ts";
import { normalizePhone } from "./phone.ts";
import { qrSvg } from "./qr.ts";
import {
  deviceWaitPage,
  loginPage,
  passwordPage,
  setupDonePage,
  setupPage,
  setupUnavailablePage,
  verifyPage,
} from "./auth-pages.ts";
import { notFoundPage } from "./pages.ts";
import type { View } from "./ui.ts";

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  path: string;
  method: string;
  now: number;
  /** الجلسة الحالية بأي مرحلة (قد تكون بانتظار الرمز). */
  current: Current | null;
  /** الجلسة الكاملة فقط (بعد كل خطوات الدخول). */
  user: Current | null;
  view: View;
}

export function homeFor(account: Account): string {
  if (account.must_change_password) return "/account/password";
  // العائلة تختار الملف (الولي أو أحد الأبناء) بعد كل دخول
  return account.role === "admin" ? "/admin" : "/profiles";
}

export async function handleAuthRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  if (path === "/login") return method === "POST" ? postLogin(ctx) : getLogin(ctx);
  if (path === "/login/verify") return method === "POST" ? postVerify(ctx) : getVerify(ctx);
  if (path === "/login/device" && method === "GET") return getDeviceWait(ctx);
  if (path === "/logout" && method === "POST") return postLogout(ctx);
  if (path === "/account/password") return method === "POST" ? postPassword(ctx) : getPassword(ctx);
  if (path === "/setup") return method === "POST" ? postSetup(ctx) : getSetup(ctx);
  return null;
}

// ---------- الدخول ----------

function getLogin(ctx: Ctx): Response {
  if (ctx.user) return redirect(homeFor(ctx.user.account));
  const next = safeNext(ctx.url.searchParams.get("next"), "");
  return page(loginPage(ctx.view, { next }));
}

async function postLogin(ctx: Ctx): Promise<Response> {
  const form = await readForm(ctx.request);
  const phone = field(form, "phone");
  const next = safeNext(field(form, "next"), "");
  const result = await attemptLogin(ctx.env.DB, ctx.env, ctx.request, phone, form.get("password") ?? "", ctx.now);
  if (!result.ok) return page(loginPage(ctx.view, { phone, error: result.message, next }), 400);

  // جلسة جديدة دائمًا عند الدخول، وتُلغى أي جلسة سابقة على هذا المتصفح
  const db = ctx.env.DB;
  await endSession(db, ctx.request);
  const { account } = result;
  if (account.role === "admin") {
    if (result.needsMfa) {
      const { cookie } = await createSession(db, account, "mfa", ctx.now);
      return redirect("/login/verify", [cookie]);
    }
    const { cookie } = await createSession(db, account, "full", ctx.now, result.trustedDeviceId);
    return redirect(next.startsWith("/admin") ? next : homeFor(account), [cookie]);
  }

  // العائلة: أول جهاز يُعتمد تلقائيًا، وأي جهاز آخر ينتظر موافقة الأستاذ
  const gate = await familyDeviceGate(db, ctx.request, account, ctx.now);
  const cookies = gate.cookie ? [gate.cookie] : [];
  if (gate.status === "pending") {
    cookies.push((await createSession(db, account, "device", ctx.now, gate.deviceId)).cookie);
    return redirect("/login/device", cookies);
  }
  cookies.push((await createSession(db, account, "full", ctx.now, gate.deviceId)).cookie);
  return redirect(homeFor(account), cookies);
}

async function getDeviceWait(ctx: Ctx): Promise<Response> {
  if (ctx.user) return redirect(homeFor(ctx.user.account));
  if (!ctx.current || ctx.current.session.stage !== "device") return redirect("/login");
  const db = ctx.env.DB;
  const status = await deviceStatus(db, ctx.current.session.device_id);
  if (status === "approved") {
    // وافق الأستاذ: تتحول الجلسة إلى جلسة كاملة على هذا الجهاز
    await endSession(db, ctx.request);
    const { cookie } = await createSession(db, ctx.current.account, "full", ctx.now, ctx.current.session.device_id);
    return redirect(homeFor(ctx.current.account), [cookie]);
  }
  return page(deviceWaitPage(ctx.view, ctx.current.account));
}

function getVerify(ctx: Ctx): Response {
  if (ctx.user) return redirect(homeFor(ctx.user.account));
  if (!ctx.current || ctx.current.session.stage !== "mfa") return redirect("/login");
  return page(verifyPage(ctx.view));
}

async function postVerify(ctx: Ctx): Promise<Response> {
  if (!ctx.current || ctx.current.session.stage !== "mfa") return redirect("/login");
  const { account } = ctx.current;
  const db = ctx.env.DB;
  const fresh = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(account.id).first<Account>();
  if (!fresh) return redirect("/login");
  if (fresh.locked_until && fresh.locked_until > ctx.now) {
    await endSession(db, ctx.request);
    return redirect("/login", [clearCookie(SESSION_COOKIE)]);
  }
  const form = await readForm(ctx.request);
  const ok = await checkSecondFactor(db, fresh, field(form, "code"), ctx.now);
  if (!ok) {
    const message = await registerFailure(db, fresh, ctx.now);
    const locked = message.startsWith("أُوقف");
    if (locked) {
      await endSession(db, ctx.request);
      return page(loginPage(ctx.view, { error: message, phone: fresh.phone }), 400, [clearCookie(SESSION_COOKIE)]);
    }
    return page(verifyPage(ctx.view, { error: "الرمز غير صحيح. تأكد أنك تنظر إلى رمز «Zinou Math» في التطبيق، وأن ساعة الهاتف مضبوطة." }), 400);
  }
  await db.prepare("UPDATE accounts SET failed_attempts = 0, locked_until = NULL WHERE id = ?").bind(fresh.id).run();
  await endSession(db, ctx.request);
  const cookies: string[] = [];
  let deviceId: number | null = null;
  if (form.get("remember") === "1") {
    const trusted = await trustDevice(db, ctx.request, fresh.id, ctx.now);
    deviceId = trusted.deviceId;
    if (trusted.cookie) cookies.push(trusted.cookie);
  }
  cookies.push((await createSession(db, fresh, "full", ctx.now, deviceId)).cookie);
  return redirect(homeFor(fresh), cookies);
}

async function postLogout(ctx: Ctx): Promise<Response> {
  await endSession(ctx.env.DB, ctx.request);
  if (ctx.current) await audit(ctx.env.DB, ctx.current.account.id, "logout", `account:${ctx.current.account.id}`);
  return redirect("/", [clearCookie(SESSION_COOKIE)]);
}

// ---------- كلمة المرور ----------

function getPassword(ctx: Ctx): Response {
  if (!ctx.user) return redirect(`/login?next=${encodeURIComponent("/account/password")}`);
  return page(passwordPage(ctx.view, { forced: Boolean(ctx.user.account.must_change_password) }));
}

async function postPassword(ctx: Ctx): Promise<Response> {
  if (!ctx.user) return redirect("/login");
  const { account, session } = ctx.user;
  const forced = Boolean(account.must_change_password);
  const form = await readForm(ctx.request);
  const password = form.get("password") ?? "";
  const confirm = form.get("confirm") ?? "";
  const iterations = passwordIterations(ctx.env);
  const errors: Record<string, string> = {};

  if (!forced) {
    const check = await verifyPassword(form.get("current") ?? "", account.password_hash, iterations);
    if (!check.ok) errors.current = "كلمة المرور الحالية غير صحيحة.";
  }
  const problem = validateNewPassword(password, confirm, account.phone);
  if (problem) errors[problem.includes("متطابقتين") ? "confirm" : "password"] = problem;
  if (!problem && (await verifyPassword(password, account.password_hash, iterations)).ok) {
    errors.password = "اختر كلمة مرور مختلفة عن الحالية.";
  }
  if (Object.keys(errors).length) return page(passwordPage(ctx.view, { forced, errors }), 400);

  await ctx.env.DB
    .prepare("UPDATE accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(password, iterations), ctx.now, account.id)
    .run();
  // من كان يعرف كلمة المرور القديمة يخرج من كل الأجهزة الأخرى
  await endOtherSessions(ctx.env.DB, account.id, session.id);
  await audit(ctx.env.DB, account.id, "password.changed", `account:${account.id}`, forced ? "أول دخول" : null);
  if (forced) return redirect(homeFor({ ...account, must_change_password: 0 }));
  return page(passwordPage(ctx.view, { forced: false, success: true }));
}

// ---------- تأسيس حساب الأستاذ ----------

async function adminExists(ctx: Ctx): Promise<boolean> {
  return Boolean(await ctx.env.DB.prepare("SELECT id FROM accounts WHERE role = 'admin' LIMIT 1").first());
}

const SETUP_ISSUER = "Zinou Math";

function setupForm(
  ctx: Ctx,
  secret: string,
  phone: string,
  extra: { values?: Record<string, string>; errors?: Record<string, string>; error?: string },
): string {
  const qr = qrSvg(totpUri(secret, phone || "admin", SETUP_ISSUER), "رمز QR لربط تطبيق المصادقة");
  return setupPage(ctx.view, { secret, qr, ...extra });
}

async function getSetup(ctx: Ctx): Promise<Response> {
  if (await adminExists(ctx)) return page(notFoundPage(ctx.view), 404);
  if (!ctx.env.ADMIN_SETUP_CODE) return page(setupUnavailablePage(ctx.view), 503);
  return page(setupForm(ctx, newTotpSecret(), "", {}));
}

async function postSetup(ctx: Ctx): Promise<Response> {
  const db = ctx.env.DB;
  if (await adminExists(ctx)) return page(notFoundPage(ctx.view), 404);
  const setupCode = ctx.env.ADMIN_SETUP_CODE;
  if (!setupCode) return page(setupUnavailablePage(ctx.view), 503);

  // حد أقصى للمحاولات الخاطئة لرمز التأسيس: 10 في الساعة
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'setup.failed' AND at > ?")
    .bind(ctx.now - 60 * 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) {
    return page(setupForm(ctx, newTotpSecret(), "", { error: "محاولات خاطئة كثيرة. حاول بعد ساعة." }), 429);
  }

  const form = await readForm(ctx.request);
  const secret = field(form, "secret").toUpperCase();
  const values = { name: field(form, "name"), phone: field(form, "phone") };
  const errors: Record<string, string> = {};
  const validSecret = /^[A-Z2-7]{32}$/.test(secret) ? secret : newTotpSecret();

  if (!safeEqual(await sha256(form.get("setup_code") ?? ""), await sha256(setupCode))) {
    await db.prepare("INSERT INTO audit_log (at, actor_id, action) VALUES (?, NULL, 'setup.failed')").bind(ctx.now).run();
    errors.setup_code = "رمز التأسيس غير صحيح.";
  }
  if (values.name.length < 2 || values.name.length > 80) errors.name = "اكتب اسمًا من حرفين على الأقل.";
  const phone = normalizePhone(values.phone);
  if (!phone) errors.phone = "رقم الهاتف غير صحيح. يجب أن يتكون من 10 أرقام ويبدأ بـ 05 أو 06 أو 07.";
  else if (await db.prepare("SELECT id FROM accounts WHERE phone = ?").bind(phone).first()) {
    errors.phone = "هذا الرقم مستعمل في حساب آخر.";
  }
  const password = form.get("password") ?? "";
  const problem = validateNewPassword(password, form.get("confirm") ?? "", phone ?? "");
  if (problem) errors[problem.includes("متطابقتين") ? "confirm" : "password"] = problem;
  if (!(await verifyTotp(validSecret, field(form, "totp"), ctx.now))) {
    errors.totp = "الرمز غير صحيح. امسح رمز QR الظاهر في هذه الصفحة ثم اكتب الرمز الجديد.";
  }
  if (Object.keys(errors).length || !phone) {
    return page(setupForm(ctx, validSecret, phone ?? "", { values, errors, error: "راجع الخانات المشار إليها." }), 400);
  }

  const iterations = passwordIterations(ctx.env);
  const created = await db
    .prepare(
      "INSERT INTO accounts (role, phone, name, password_hash, must_change_password, totp_secret, created_at, updated_at) VALUES ('admin', ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(phone, values.name, await hashPassword(password, iterations), validSecret, ctx.now, ctx.now)
    .run();
  const adminId = Number(created.meta.last_row_id);
  const codes = Array.from({ length: 8 }, () => recoveryCode());
  const inserts = await Promise.all(
    codes.map(async (c) =>
      db.prepare("INSERT INTO recovery_codes (account_id, code_hash) VALUES (?, ?)").bind(adminId, await sha256(normalizeRecoveryCode(c))),
    ),
  );
  await db.batch(inserts);
  await audit(db, adminId, "admin.created", `account:${adminId}`);

  const account = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(adminId).first<Account>();
  if (!account) return page(notFoundPage(ctx.view), 500);
  const trusted = await trustDevice(db, ctx.request, adminId, ctx.now);
  const cookies = [(await createSession(db, account, "full", ctx.now, trusted.deviceId)).cookie];
  if (trusted.cookie) cookies.push(trusted.cookie);
  return page(setupDonePage({ ...ctx.view, viewer: { name: account.name, role: "admin" } }, codes), 200, cookies);
}
