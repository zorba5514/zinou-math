import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  hashPassword,
  recoveryCode,
  temporaryPassword,
  totpAt,
  totpUri,
  verifyPassword,
  verifyTotp,
} from "../src/crypto.ts";
import { formatPhone, normalizePhone, whatsappNumber } from "../src/phone.ts";
import { encodeQr } from "../src/qr.ts";

test("TOTP يطابق أمثلة المعيار الرسمي RFC 6238", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [t, code] of vectors) {
    assert.equal(await totpAt(secret, t * 1000, { digits: 8 }), code, `t=${t}`);
  }
});

test("TOTP يقبل الرمز الحالي والمجاور فقط", async () => {
  const b32 = base32Encode(new TextEncoder().encode("12345678901234567890"));
  assert.equal(b32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  const now = 1_700_000_000_000;
  const secret = base32Decode(b32);
  const current = await totpAt(secret, now);
  assert.ok(await verifyTotp(b32, current, now));
  assert.ok(await verifyTotp(b32, await totpAt(secret, now - 30_000), now));
  assert.ok(await verifyTotp(b32, await totpAt(secret, now + 30_000), now));
  assert.ok(!(await verifyTotp(b32, await totpAt(secret, now - 120_000), now)));
  assert.ok(!(await verifyTotp(b32, "12345", now)));
  assert.ok(!(await verifyTotp(b32, "abcdef", now)));
});

test("كلمات المرور تُحفظ مشفّرة وتُتحقق بشكل صحيح", async () => {
  const stored = await hashPassword("سر-قوي-123", 2000);
  assert.match(stored, /^pbkdf2-sha256\$2000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!stored.includes("سر-قوي-123"));
  assert.deepEqual(await verifyPassword("سر-قوي-123", stored, 2000), { ok: true, needsRehash: false });
  assert.equal((await verifyPassword("خطأ", stored, 2000)).ok, false);
  // نفس كلمة المرور تعطي بصمة مختلفة كل مرة (ملح عشوائي)
  assert.notEqual(stored, await hashPassword("سر-قوي-123", 2000));
  // عند رفع مستوى التشفير يُطلب إعادة التشفير
  assert.deepEqual(await verifyPassword("سر-قوي-123", stored, 100_000), { ok: true, needsRehash: true });
  assert.equal((await verifyPassword("x", "plain-text", 2000)).ok, false);
});

test("كلمة المرور المؤقتة ورموز الطوارئ سهلة القراءة", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(temporaryPassword(), /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    assert.match(recoveryCode(), /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  }
});

test("أرقام الهاتف الجزائرية تُوحَّد بصيغة واحدة", () => {
  assert.equal(normalizePhone("0555 12 34 56"), "0555123456");
  assert.equal(normalizePhone("+213 555 12 34 56"), "0555123456");
  assert.equal(normalizePhone("00213555123456"), "0555123456");
  assert.equal(normalizePhone("213-661-23-45-67"), "0661234567");
  assert.equal(normalizePhone("٠٧٧٠١٢٣٤٥٦"), "0770123456");
  assert.equal(normalizePhone("0455123456"), null);
  assert.equal(normalizePhone("055512345"), null);
  assert.equal(normalizePhone("abc"), null);
  assert.equal(formatPhone("0555123456"), "0555 12 34 56");
  assert.equal(whatsappNumber("0555123456"), "213555123456");
});

test("رمز QR: الحجم يناسب طول النص، ونمط التموضع في مكانه", () => {
  const small = encodeQr("HELLO");
  assert.equal(small.length, 21);
  const uri = totpUri("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "0555123456", "Zinou Math");
  const m = encodeQr(uri);
  assert.ok(m.length >= 21 && m.length <= 57);
  // زوايا التموضع: إطار أسود 7×7 بداخله إطار أبيض ومربع أسود
  for (const [x0, y0] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
    assert.equal(m[y0]?.[x0], true);
    assert.equal(m[y0 + 1]?.[x0 + 1], false);
    assert.equal(m[y0 + 3]?.[x0 + 3], true);
  }
});
