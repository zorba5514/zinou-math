// أدوات التشفير: كلمات المرور، والرموز العشوائية، والرمز ذو الأرقام الستة (TOTP).
// كلها مبنية على WebCrypto المدمجة في Cloudflare Workers، دون مكتبات خارجية.

const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** رمز عشوائي طويل (للجلسات والأجهزة). */
export function randomToken(): string {
  return toB64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** بصمة SHA-256 بصيغة hex. تُحفظ في القاعدة بدل الرمز نفسه. */
export async function sha256(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/** مقارنة لا يتغير زمنها حسب موضع أول اختلاف. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** حروف سهلة القراءة: بدون 0 وo و1 وl وi التي يُخلط بينها. */
const FRIENDLY = "abcdefghjkmnpqrstuvwxyz23456789";

export function randomFriendly(length: number): string {
  const out: string[] = [];
  // رفض القيم التي تسبب انحيازًا في التوزيع
  const limit = 256 - (256 % FRIENDLY.length);
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit && out.length < length) out.push(FRIENDLY[b % FRIENDLY.length] ?? "");
    }
  }
  return out.join("");
}

/** كلمة مرور مؤقتة مثل k7m4-p9x2: سهلة الإملاء عبر الهاتف. */
export function temporaryPassword(): string {
  const s = randomFriendly(8);
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// ---------- كلمات المرور ----------

/** الحد الأقصى الذي تقبله Cloudflare Workers لـ PBKDF2. */
export const MAX_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const n = Math.min(Math.max(1000, Math.floor(iterations)), MAX_ITERATIONS);
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, n);
  return `pbkdf2-sha256$${n}$${toB64(salt)}$${toB64(hash)}`;
}

export interface VerifyResult {
  ok: boolean;
  /** صحيحة لكن بتشفير أضعف من المطلوب: تُعاد تشفيرها عند الدخول. */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string, wantIterations: number): Promise<VerifyResult> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iter || !salt || !hash) return { ok: false, needsRehash: false };
  const n = Number(iter);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ITERATIONS) return { ok: false, needsRehash: false };
  const got = toB64(await pbkdf2(password, fromB64(salt), n));
  const ok = safeEqual(got, hash);
  return { ok, needsRehash: ok && n < Math.min(wantIterations, MAX_ITERATIONS) };
}

// ---------- الرمز ذو الأرقام الستة (TOTP، المعيار RFC 6238) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("حرف غير صالح في المفتاح");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

async function hotp(secret: Uint8Array<ArrayBuffer>, counter: number, digits: number, hash: "SHA-1" | "SHA-256" | "SHA-512"): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const code =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export async function totpAt(
  secret: Uint8Array<ArrayBuffer>,
  timeMs: number,
  opts: { digits?: number; step?: number; hash?: "SHA-1" | "SHA-256" | "SHA-512" } = {},
): Promise<string> {
  const step = opts.step ?? 30;
  return hotp(secret, Math.floor(timeMs / 1000 / step), opts.digits ?? 6, opts.hash ?? "SHA-1");
}

/** يقبل الرمز الحالي والذي قبله والذي بعده (فرق 30 ثانية في ساعة الهاتف). */
export async function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): Promise<boolean> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const secret = base32Decode(secretB32);
  for (const drift of [0, -1, 1]) {
    if (safeEqual(await totpAt(secret, nowMs + drift * 30_000), clean)) return true;
  }
  return false;
}

/** الرابط الذي يقرؤه تطبيق المصادقة من رمز QR. */
export function totpUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** رموز الطوارئ: 10 حروف مقسومة لسهولة الكتابة، مثل abcde-23456. */
export function recoveryCode(): string {
  const s = randomFriendly(10);
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}
