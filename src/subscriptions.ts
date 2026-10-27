// الاشتراكات: من يحق له فتح الدرس المدفوع، وحالة اشتراك كل ابن، والإعدادات التي يكتبها الأستاذ.
//
// قاعدة الفتح (قرار الأستاذ):
// - الاشتراك الساري يفتح كل دروس المستوى أو الدورة.
// - بعد انتهائه، يبقى مفتوحًا سنةً كاملة ما نُشر قبل تاريخ الانتهاء، ويُقفل ما نُشر بعده.
// - الولي يرى ما يراه أبناؤه.

import type { D1Database } from "./db.ts";

const DAY = 24 * 60 * 60 * 1000;
/** مدة بقاء المحتوى القديم مفتوحًا بعد انتهاء الاشتراك، ومدة الدورة. */
export const GRACE_MS = 365 * DAY;
export const COURSE_MS = 365 * DAY;
/** قبل كم يوم من الانتهاء يظهر للولي «حان وقت الدفع». */
export const DUE_DAYS = 14;
/** قبل كم يوم يظهر الاشتراك في قائمة «تنتهي قريبًا» في لوحة التحكم. */
export const ENDING_SOON_DAYS = 7;

export type SubKind = "term1" | "term2" | "term3" | "year" | "course";

export const KIND_TITLES: Record<SubKind, string> = {
  term1: "الفصل الأول",
  term2: "الفصل الثاني",
  term3: "الفصل الثالث",
  year: "السنة كاملة",
  course: "دورة (سنة)",
};

export interface Subscription {
  id: number;
  student_id: number;
  program_slug: string;
  kind: SubKind;
  starts_at: number;
  ends_at: number;
  note: string | null;
  created_by: number | null;
  created_at: number;
}

// ---------- التواريخ (بتوقيت الجزائر) ----------

/** الجزائر على UTC+1 طوال السنة (لا توقيت صيفي). */
const ALGIERS_OFFSET = 60 * 60 * 1000;

/** «2026-12-17» ← آخر لحظة من ذلك اليوم بتوقيت الجزائر. null إن كان التاريخ غير صالح. */
export function endOfDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d, 23, 59, 59, 999);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return t - ALGIERS_OFFSET;
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("ar-DZ-u-nu-latn", { timeZone: "Africa/Algiers", day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
}

// ---------- الإعدادات ----------

export const SETTING_KEYS = ["term1_end", "term2_end", "term3_end", "whatsapp", "payment_info", "price_term", "price_year", "price_course"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Partial<Record<SettingKey, string>>;

export async function getSettings(db: D1Database): Promise<Settings> {
  const r = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const out: Settings = {};
  for (const row of r.results) if ((SETTING_KEYS as readonly string[]).includes(row.key)) out[row.key as SettingKey] = row.value;
  return out;
}

/** تاريخ نهاية الاشتراك حسب نوعه، أو رسالة خطأ. */
export function computeEnd(kind: SubKind, settings: Settings, now: number): { ok: true; endsAt: number } | { ok: false; error: string } {
  if (kind === "course") return { ok: true, endsAt: now + COURSE_MS };
  const key = kind === "year" ? "term3_end" : (`${kind}_end` as SettingKey);
  const date = settings[key];
  const endsAt = date ? endOfDay(date) : null;
  if (!endsAt) {
    return { ok: false, error: "اكتب أولًا تواريخ نهاية الفصول في «الإعدادات»." };
  }
  if (endsAt <= now) {
    return { ok: false, error: `${kind === "year" ? "السنة الدراسية" : KIND_TITLES[kind]} انتهى في ${formatDate(endsAt)}. حدّث التواريخ في «الإعدادات» للسنة الجديدة.` };
  }
  return { ok: true, endsAt };
}

// ---------- من يحق له الفتح ----------

export interface Access {
  /** الأستاذ: يفتح كل شيء */
  all: boolean;
  subs: Pick<Subscription, "program_slug" | "starts_at" | "ends_at">[];
  now: number;
}

export const NO_ACCESS: Access = { all: false, subs: [], now: 0 };

/**
 * اشتراكات ابن أو كل أبناء حساب، التي تحسب في الفتح:
 * المدفوعة، أو التي ما زالت في مهلة الدفع (الاشتراك غير المدفوع يتوقف بعد المهلة).
 */
export function accessStatement(db: D1Database, who: { studentId: number } | { accountId: number }, now: number) {
  const paid = "(s.payment_id IS NOT NULL OR s.pay_due_at IS NULL OR s.pay_due_at >= ?)";
  return "studentId" in who
    ? db.prepare(`SELECT s.program_slug, s.starts_at, s.ends_at FROM subscriptions s WHERE s.student_id = ? AND ${paid}`).bind(who.studentId, now)
    : db
        .prepare(
          `SELECT s.program_slug, s.starts_at, s.ends_at FROM subscriptions s JOIN students st ON st.id = s.student_id
           WHERE st.account_id = ? AND st.status = 'active' AND ${paid}`,
        )
        .bind(who.accountId, now);
}

/** وقت ظهور الدرس للعامة: آخر الاثنين، نشر الدرس ونشر مقطعه. */
export function visibleSince(lesson: { published_at: number | null }, unit: { published_at: number | null }): number | null {
  if (lesson.published_at === null || unit.published_at === null) return null;
  return Math.max(lesson.published_at, unit.published_at);
}

export function canOpen(access: Access, item: { free: number; program_slug: string; visible_since: number | null }): boolean {
  if (item.free || access.all) return true;
  const now = access.now;
  return access.subs.some((s) => {
    // اشتراك لم يبدأ بعد لا يفتح شيئًا
    if (s.program_slug !== item.program_slug || s.starts_at > now) return false;
    if (now <= s.ends_at) return true;
    return now <= s.ends_at + GRACE_MS && item.visible_since !== null && item.visible_since <= s.ends_at;
  });
}

// ---------- حالة الاشتراك ----------

export type SubState = "none" | "active" | "due" | "expired";

export interface SubStatus {
  state: SubState;
  /** آخر اشتراك (الأبعد انتهاءً) */
  latest: Subscription | null;
}

/** حالة اشتراك ابن في مستوى أو دورة، من كل اشتراكاته فيه. */
export function subscriptionStatus(subs: Subscription[], programSlug: string, now: number): SubStatus {
  const mine = subs.filter((s) => s.program_slug === programSlug && s.starts_at <= now);
  if (!mine.length) return { state: "none", latest: null };
  const latest = mine.reduce((a, b) => (b.ends_at > a.ends_at ? b : a));
  if (latest.ends_at < now) return { state: "expired", latest };
  if (latest.ends_at - now <= DUE_DAYS * DAY) return { state: "due", latest };
  return { state: "active", latest };
}

export function statusLabel(st: SubStatus): string {
  switch (st.state) {
    case "none":
      return "غير مشترك";
    case "expired":
      return `انتهى في ${formatDate(st.latest!.ends_at)}`;
    case "due":
      return st.latest!.kind.startsWith("term") ? `حان وقت دفع الفصل التالي (ينتهي ${formatDate(st.latest!.ends_at)})` : `ينتهي قريبًا: ${formatDate(st.latest!.ends_at)}`;
    default:
      return `مشترك حتى ${formatDate(st.latest!.ends_at)}`;
  }
}
