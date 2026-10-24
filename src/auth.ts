// منطق الحسابات: الجلسات، وتسجيل الدخول، والقفل بعد المحاولات الخاطئة، والأجهزة المعتمدة للأستاذ.
// لا يُحفظ أي رمز جلسة أو جهاز في القاعدة كما هو: تُحفظ بصمته فقط.

import { audit, type Account, type D1Database } from "./db.ts";
import {
  hashPassword,
  MAX_ITERATIONS,
  normalizeRecoveryCode,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
} from "./crypto.ts";
import { DEVICE_COOKIE, SESSION_COOKIE, readCookies, setCookie, type Env } from "./http.ts";
import { normalizePhone } from "./phone.ts";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const SESSION_TTL = { parent: 60 * DAY, admin: 7 * DAY, mfa: 10 * MINUTE } as const;
export const DEVICE_TTL = 365 * DAY;

export function passwordIterations(env: Env): number {
  const n = Number(env.PASSWORD_ITERATIONS);
  return Number.isInteger(n) && n >= 1000 ? Math.min(n, MAX_ITERATIONS) : MAX_ITERATIONS;
}

// بصمة وهمية تُفحص عند إدخال رقم غير مسجل، بنفس قوة التشفير، حتى يستغرق الرد نفس الوقت
// ولا يعرف أحد من سرعة الرد إن كان الرقم مسجلًا.
function dummyHash(iterations: number): string {
  return `pbkdf2-sha256$${iterations}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;
}

// ---------- الجلسات ----------

export interface SessionRow {
  id: string;
  account_id: number;
  stage: "mfa" | "full";
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

export interface Current {
  session: SessionRow;
  account: Account;
}

export async function createSession(
  db: D1Database,
  account: Account,
  stage: "mfa" | "full",
  now = Date.now(),
): Promise<{ token: string; cookie: string }> {
  const token = randomToken();
  const ttl = stage === "mfa" ? SESSION_TTL.mfa : account.role === "admin" ? SESSION_TTL.admin : SESSION_TTL.parent;
  await db
    .prepare("INSERT INTO sessions (id, account_id, stage, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), account.id, stage, now, now + ttl, now)
    .run();
  return { token, cookie: setCookie(SESSION_COOKIE, token, ttl / 1000) };
}

/** يقرأ الجلسة من الكعكة، ويتحقق أنها سارية وأن الحساب فعّال. */
export async function currentSession(db: D1Database, request: Request, now = Date.now()): Promise<Current | null> {
  const token = readCookies(request).get(SESSION_COOKIE);
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = await sha256(token);
  const session = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
  if (!session || session.expires_at <= now) return null;
  const account = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(session.account_id).first<Account>();
  if (!account || account.status !== "active") return null;
  if (now - session.last_seen_at > 10 * MINUTE) {
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(now, id).run();
  }
  return { session, account };
}

export async function endSession(db: D1Database, request: Request): Promise<void> {
  const token = readCookies(request).get(SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
}

export async function endOtherSessions(db: D1Database, accountId: number, keepId: string | null): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE account_id = ? AND id IS NOT ?").bind(accountId, keepId).run();
}

// ---------- تسجيل الدخول ----------

export type LoginResult =
  | { ok: true; account: Account; needsMfa: boolean }
  | { ok: false; message: string };

const WRONG = "رقم الهاتف أو كلمة المرور غير صحيحة.";

export async function attemptLogin(
  db: D1Database,
  env: Env,
  request: Request,
  phoneInput: string,
  password: string,
  now = Date.now(),
): Promise<LoginResult> {
  const iterations = passwordIterations(env);
  const phone = normalizePhone(phoneInput);
  const account = phone
    ? await db.prepare("SELECT * FROM accounts WHERE phone = ?").bind(phone).first<Account>()
    : null;
  if (!account) {
    await verifyPassword(password, dummyHash(iterations), iterations);
    return { ok: false, message: WRONG };
  }
  if (account.locked_until && account.locked_until > now) {
    const minutes = Math.ceil((account.locked_until - now) / MINUTE);
    return { ok: false, message: `أُوقف الدخول مؤقتًا بسبب محاولات خاطئة متكررة. حاول بعد ${minutes} دقيقة، أو تواصل مع الأستاذ.` };
  }
  const check = await verifyPassword(password, account.password_hash, iterations);
  if (!check.ok) {
    return { ok: false, message: await registerFailure(db, account, now) };
  }
  if (account.status !== "active") {
    return { ok: false, message: "هذا الحساب موقوف. تواصل مع الأستاذ." };
  }
  const updates = ["failed_attempts = 0", "locked_until = NULL", "updated_at = ?"];
  const values: unknown[] = [now];
  if (check.needsRehash) {
    updates.push("password_hash = ?");
    values.push(await hashPassword(password, iterations));
  }
  await db.prepare(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ?`).bind(...values, account.id).run();

  let needsMfa = false;
  if (account.role === "admin") {
    needsMfa = !(await isTrustedDevice(db, request, account.id, now));
  }
  await audit(db, account.id, "login", `account:${account.id}`, needsMfa ? "بانتظار الرمز" : null);
  return { ok: true, account, needsMfa };
}

/** يسجّل محاولة خاطئة، ويقفل الحساب بعد 5 محاولات. يُرجع رسالة الخطأ المناسبة. */
export async function registerFailure(db: D1Database, account: Account, now = Date.now()): Promise<string> {
  const failed = account.failed_attempts + 1;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    await db
      .prepare("UPDATE accounts SET failed_attempts = 0, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(now + LOCK_MINUTES * MINUTE, now, account.id)
      .run();
    await audit(db, null, "account.locked", `account:${account.id}`, `${MAX_FAILED_ATTEMPTS} محاولات خاطئة`);
    return `أُوقف الدخول مؤقتًا لمدة ${LOCK_MINUTES} دقيقة بسبب ${MAX_FAILED_ATTEMPTS} محاولات خاطئة.`;
  }
  await db.prepare("UPDATE accounts SET failed_attempts = ?, updated_at = ? WHERE id = ?").bind(failed, now, account.id).run();
  const left = MAX_FAILED_ATTEMPTS - failed;
  return left <= 2 ? `${WRONG} بقيت ${left === 1 ? "محاولة واحدة" : "محاولتان"} قبل إيقاف الدخول مؤقتًا.` : WRONG;
}

// ---------- الرمز ذو الأرقام الستة ورموز الطوارئ ----------

export async function checkSecondFactor(db: D1Database, account: Account, code: string, now = Date.now()): Promise<boolean> {
  if (account.totp_secret && (await verifyTotp(account.totp_secret, code, now))) return true;
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 10) return false;
  const hash = await sha256(normalized);
  const row = await db
    .prepare("SELECT id FROM recovery_codes WHERE account_id = ? AND code_hash = ? AND used_at IS NULL")
    .bind(account.id, hash)
    .first<{ id: number }>();
  if (!row) return false;
  await db.prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ?").bind(now, row.id).run();
  await audit(db, account.id, "recovery_code.used", `account:${account.id}`);
  return true;
}

// ---------- الأجهزة المعتمدة ----------

export async function isTrustedDevice(db: D1Database, request: Request, accountId: number, now = Date.now()): Promise<boolean> {
  const token = readCookies(request).get(DEVICE_COOKIE);
  if (!token || token.length < 20 || token.length > 100) return false;
  const hash = await sha256(token);
  const row = await db
    .prepare("SELECT id, created_at FROM devices WHERE token_hash = ? AND account_id = ? AND status = 'approved'")
    .bind(hash, accountId)
    .first<{ id: number; created_at: number }>();
  if (!row || now - row.created_at > DEVICE_TTL) return false;
  await db.prepare("UPDATE devices SET last_used_at = ? WHERE id = ?").bind(now, row.id).run();
  return true;
}

export function deviceLabel(request: Request): string {
  const ua = request.headers.get("User-Agent") ?? "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "جهاز";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os}، ${browser}` : os;
}

export async function trustDevice(db: D1Database, request: Request, accountId: number, now = Date.now()): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO devices (account_id, token_hash, label, status, created_at, last_used_at) VALUES (?, ?, ?, 'approved', ?, ?)")
    .bind(accountId, await sha256(token), deviceLabel(request), now, now)
    .run();
  await audit(db, accountId, "device.trusted", `account:${accountId}`, deviceLabel(request));
  return setCookie(DEVICE_COOKIE, token, DEVICE_TTL / 1000);
}

// ---------- كلمات المرور الجديدة ----------

export function validateNewPassword(password: string, confirm: string, phone: string): string | null {
  if (password.length < 8) return "كلمة المرور قصيرة: 8 حروف أو أرقام على الأقل.";
  if (password.length > 200) return "كلمة المرور طويلة جدًا.";
  if (password !== confirm) return "كلمتا المرور غير متطابقتين.";
  if (/^(.)\1+$/.test(password)) return "اختر كلمة مرور لا تتكرر فيها نفس الخانة.";
  if (password.replace(/\D/g, "").includes(phone.slice(1)) || password === phone) return "لا تستعمل رقم الهاتف ككلمة مرور.";
  if (["12345678", "123456789", "1234567890", "azerty123", "password", "motdepasse"].includes(password.toLowerCase())) {
    return "كلمة المرور هذه سهلة التخمين. اختر غيرها.";
  }
  return null;
}
