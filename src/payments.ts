// الدفعات وتفعيل الاشتراكات.
//
// قواعد الأستاذ:
// - الاشتراك يُفعَّل فورًا عند إنشاء العائلة أو إضافة ابن أو التجديد.
// - المبلغ (من الوصل) يخص الولي، ويُقسَّم بالتساوي على اشتراكات الأبناء في نفس الدفعة،
//   فيُعرف لاحقًا نصيب كل مستوى من المداخيل.
// - بدون مبلغ: مهلة دفع 15 يومًا، ثم يتوقف الاشتراك حتى تُسجَّل الدفعة.

import { audit, type D1Database, type D1PreparedStatement } from "./db.ts";
import { KIND_TITLES, computeEnd, formatDate, type Settings, type SubKind, type Subscription } from "./subscriptions.ts";

const DAY = 24 * 60 * 60 * 1000;
export const PAY_GRACE_DAYS = 15;
export const MAX_AMOUNT = 10_000_000;

export interface Payment {
  id: number;
  account_id: number;
  amount: number;
  receipt: string | null;
  paid_at: number;
  created_by: number | null;
  created_at: number;
}

/** «4000» أو «4 000» أو «4.000 دج» ← 4000. فارغ ← null. غير صالح ← NaN. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/دج|da|dzd/gi, "").trim();
  if (!t) return null;
  const digits = t.replace(/[\s.,'’]/g, "");
  if (!/^\d+$/.test(digits)) return NaN;
  const n = Number(digits);
  return n > 0 && n <= MAX_AMOUNT ? n : NaN;
}

export function formatAmount(n: number): string {
  return `${n.toLocaleString("fr-FR").replace(/ /g, " ")} دج`;
}

/** تقسيم المبلغ بالتساوي بالدينار الكامل؛ الباقي يوزَّع دينارًا دينارًا على الأوائل. */
export function splitAmount(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/** الفصل الحالي: أول فصل لم تنته مدته بعد، حسب تواريخ الإعدادات. */
export function currentTerm(settings: Settings, now: number): SubKind | null {
  for (const k of ["term1", "term2", "term3"] as const) {
    const end = computeEnd(k, settings, now);
    if (end.ok) return k;
  }
  return null;
}

export interface PackageItem {
  studentId: number;
  studentName: string;
  programSlug: string;
  kind: SubKind;
}

export type Prepared = { ok: true; rows: (PackageItem & { endsAt: number })[] } | { ok: false; error: string; studentId: number };

/** يتحقق أن كل باقة لها تاريخ نهاية صالح، قبل أي كتابة في القاعدة. */
export function prepareItems(items: PackageItem[], settings: Settings, now: number): Prepared {
  const rows: (PackageItem & { endsAt: number })[] = [];
  for (const it of items) {
    const end = computeEnd(it.kind, settings, now);
    if (!end.ok) return { ok: false, error: end.error, studentId: it.studentId };
    rows.push({ ...it, endsAt: end.endsAt });
  }
  return { ok: true, rows };
}

/**
 * يفعّل الاشتراكات فورًا. مع مبلغ: دفعة واحدة للولي تُقسَّم عليها. بدون مبلغ: مهلة 15 يومًا.
 * يُرجع رقم الدفعة إن وُجدت.
 */
export async function activate(
  db: D1Database,
  o: {
    accountId: number;
    rows: (PackageItem & { endsAt: number })[];
    amount: number | null;
    receipt: string | null;
    now: number;
    adminId: number;
  },
): Promise<number | null> {
  if (!o.rows.length) return null;
  let paymentId: number | null = null;
  if (o.amount) {
    const r = await db
      .prepare("INSERT INTO payments (account_id, amount, receipt, paid_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(o.accountId, o.amount, o.receipt, o.now, o.adminId, o.now)
      .run();
    paymentId = Number(r.meta.last_row_id);
  }
  const shares = o.amount ? splitAmount(o.amount, o.rows.length) : [];
  const dueAt = o.amount ? null : o.now + PAY_GRACE_DAYS * DAY;
  const statements: D1PreparedStatement[] = o.rows.map((row, i) =>
    db
      .prepare(
        `INSERT INTO subscriptions (student_id, program_slug, kind, starts_at, ends_at, created_by, created_at, payment_id, amount, pay_due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.studentId, row.programSlug, row.kind, o.now, row.endsAt, o.adminId, o.now, paymentId, shares[i] ?? null, dueAt),
  );
  await db.batch(statements);
  const what = o.rows.map((r) => `${r.studentName} · ${KIND_TITLES[r.kind]}`).join("، ");
  await audit(db, o.adminId, "subscription.activated", `account:${o.accountId}`, o.amount ? `${what} · ${formatAmount(o.amount)}` : `${what} · مهلة دفع حتى ${formatDate(dueAt!)}`);
  return paymentId;
}

/** يسجّل دفعة لاحقة لاشتراكات غير مدفوعة، ويقسم المبلغ عليها. */
export async function recordPayment(
  db: D1Database,
  o: { accountId: number; subs: Subscription[]; amount: number; receipt: string | null; now: number; adminId: number },
): Promise<void> {
  const r = await db
    .prepare("INSERT INTO payments (account_id, amount, receipt, paid_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(o.accountId, o.amount, o.receipt, o.now, o.adminId, o.now)
    .run();
  const paymentId = Number(r.meta.last_row_id);
  const shares = splitAmount(o.amount, o.subs.length);
  await db.batch(o.subs.map((s, i) => db.prepare("UPDATE subscriptions SET payment_id = ?, amount = ? WHERE id = ?").bind(paymentId, shares[i] ?? 0, s.id)));
  await audit(db, o.adminId, "payment.recorded", `account:${o.accountId}`, formatAmount(o.amount));
}

export interface UnpaidRow {
  id: number;
  account_id: number;
  parent: string;
  student: string;
  program: string;
  kind: SubKind;
  pay_due_at: number;
}

/** الاشتراكات غير المدفوعة السارية (للوحة التحكم): في المهلة أو بعدها. */
export async function unpaidSubscriptions(db: D1Database, now: number): Promise<UnpaidRow[]> {
  const r = await db
    .prepare(
      `SELECT s.id, st.account_id, a.name AS parent, st.name AS student, p.title AS program, s.kind, s.pay_due_at
       FROM subscriptions s JOIN students st ON st.id = s.student_id JOIN accounts a ON a.id = st.account_id JOIN programs p ON p.slug = s.program_slug
       WHERE s.payment_id IS NULL AND s.pay_due_at IS NOT NULL AND s.ends_at >= ? AND st.status = 'active' AND a.status = 'active'
       ORDER BY s.pay_due_at LIMIT 200`,
    )
    .bind(now)
    .all<UnpaidRow>();
  return r.results;
}
