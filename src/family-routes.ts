// مسارات العائلة بعد الدخول: اختيار الملف، والرمز السري لكل ملف، وصفحة الولي، وصفحة الابن.
//
// القواعد:
// - كل هذه الصفحات تحتاج جلسة كاملة لحساب عائلة (ليس الأستاذ).
// - الملف المختار يُحفظ في الجلسة نفسها (profile_kind و student_id).
// - الملف المحمي برمز يطلب الرمز، إلا إذا كان الولي هو من يدخل إلى ملف أحد أبنائه.
// - 5 رموز خاطئة تقفل ذلك الملف 15 دقيقة.

import { audit, type Account, type Device, type Student } from "./db.ts";
import { LOCK_MINUTES, MAX_FAILED_ATTEMPTS, passwordIterations, setProfile } from "./auth.ts";
import { hashPassword, verifyPassword } from "./crypto.ts";
import { field, page, readForm, redirect } from "./http.ts";
import { listPrograms } from "./content.ts";
import { getSettings, subscriptionStatus, type Subscription } from "./subscriptions.ts";
import { parentPage, pinsPage, profilesPage, studentHomePage, unlockPage, type PinProfile } from "./family-pages.ts";
import type { Ctx } from "./auth-routes.ts";

const MINUTE = 60_000;

type Kind = "parent" | "student";

interface Target {
  kind: Kind;
  student: Student | null;
  name: string;
  pinHash: string | null;
  failed: number;
  lockedUntil: number | null;
}

export function isFamilyPath(path: string): boolean {
  return path === "/profiles" || path.startsWith("/profiles/") || path === "/home" || path === "/account" || path === "/account/pins";
}

export async function activeStudents(ctx: Ctx, accountId: number): Promise<Student[]> {
  const r = await ctx.env.DB
    .prepare("SELECT * FROM students WHERE account_id = ? AND status = 'active' ORDER BY id")
    .bind(accountId)
    .all<Student>();
  return r.results;
}

async function loadTarget(ctx: Ctx, account: Account, kind: string, studentId: string | null): Promise<Target | null> {
  if (kind === "parent") {
    return {
      kind: "parent",
      student: null,
      name: "ملف الولي",
      pinHash: account.parent_pin_hash,
      failed: account.parent_pin_failed,
      lockedUntil: account.parent_pin_locked_until,
    };
  }
  if (kind !== "student" || !studentId || !/^\d+$/.test(studentId)) return null;
  const s = await ctx.env.DB
    .prepare("SELECT * FROM students WHERE id = ? AND account_id = ? AND status = 'active'")
    .bind(Number(studentId), account.id)
    .first<Student>();
  if (!s) return null;
  return { kind: "student", student: s, name: s.name, pinHash: s.pin_hash, failed: s.pin_failed, lockedUntil: s.pin_locked_until };
}

function homeOf(kind: Kind): string {
  return kind === "student" ? "/home" : "/account";
}

function unlockUrl(t: Target): string {
  return t.kind === "student" ? `/profiles/unlock?kind=student&id=${t.student?.id}` : "/profiles/unlock?kind=parent";
}

async function enter(ctx: Ctx, t: Target): Promise<Response> {
  const user = ctx.user as NonNullable<Ctx["user"]>;
  await setProfile(ctx.env.DB, user.session.id, t.kind, t.student?.id ?? null);
  return redirect(homeOf(t.kind));
}

export async function handleFamilyRoutes(ctx: Ctx): Promise<Response | null> {
  const { path, method } = ctx;
  if (!isFamilyPath(path)) return null;
  if (!ctx.user) return redirect(`/login?next=${encodeURIComponent(path)}`);
  if (ctx.user.account.role !== "parent") return redirect("/admin");

  if (path === "/profiles") return method === "GET" ? getProfiles(ctx) : null;
  if (path === "/profiles/select") return method === "POST" ? postSelect(ctx) : redirect("/profiles");
  if (path === "/profiles/unlock") return method === "POST" ? postUnlock(ctx) : getUnlock(ctx);
  if (path === "/home") return method === "GET" ? getStudentHome(ctx) : null;
  if (path === "/account") return method === "GET" ? getParent(ctx) : null;
  if (path === "/account/pins") return method === "POST" ? postPins(ctx) : getPins(ctx);
  return null;
}

// ---------- اختيار الملف ----------

async function getProfiles(ctx: Ctx): Promise<Response> {
  const { account } = ctx.user!;
  return page(profilesPage(ctx.view, account, await activeStudents(ctx, account.id)));
}

async function postSelect(ctx: Ctx): Promise<Response> {
  const { account, session } = ctx.user!;
  const form = await readForm(ctx.request);
  const target = await loadTarget(ctx, account, field(form, "kind"), field(form, "student_id") || null);
  if (!target) return redirect("/profiles");
  // نفس الملف الحالي: لا حاجة للرمز
  const same = session.profile_kind === target.kind && (target.kind === "parent" || session.student_id === target.student?.id);
  // الولي يدخل إلى ملف أي ابن دون رمز الابن
  const parentToChild = session.profile_kind === "parent" && target.kind === "student";
  if (target.pinHash && !same && !parentToChild) return redirect(unlockUrl(target));
  return enter(ctx, target);
}

function lockMessage(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / MINUTE));
  return `أُوقف هذا الملف مؤقتًا بسبب رموز خاطئة. حاول بعد ${minutes} دقيقة، أو اطلب من الولي تغيير الرمز.`;
}

async function getUnlock(ctx: Ctx): Promise<Response> {
  const { account } = ctx.user!;
  const target = await loadTarget(ctx, account, ctx.url.searchParams.get("kind") ?? "", ctx.url.searchParams.get("id"));
  if (!target) return redirect("/profiles");
  if (!target.pinHash) return enter(ctx, target);
  const locked = target.lockedUntil && target.lockedUntil > ctx.now ? lockMessage(target.lockedUntil, ctx.now) : undefined;
  return page(unlockPage(ctx.view, { kind: target.kind, studentId: target.student?.id ?? null, name: target.name, error: locked }));
}

async function postUnlock(ctx: Ctx): Promise<Response> {
  const { account } = ctx.user!;
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const target = await loadTarget(ctx, account, field(form, "kind"), field(form, "student_id") || null);
  if (!target) return redirect("/profiles");
  if (!target.pinHash) return enter(ctx, target);
  const show = (error: string, status = 400) =>
    page(unlockPage(ctx.view, { kind: target.kind, studentId: target.student?.id ?? null, name: target.name, error }), status);

  if (target.lockedUntil && target.lockedUntil > ctx.now) return show(lockMessage(target.lockedUntil, ctx.now), 429);

  const table = target.kind === "parent" ? "accounts" : "students";
  const cols = target.kind === "parent"
    ? { failed: "parent_pin_failed", locked: "parent_pin_locked_until" }
    : { failed: "pin_failed", locked: "pin_locked_until" };
  const id = target.kind === "parent" ? account.id : target.student!.id;

  const pin = field(form, "pin");
  const ok = /^\d{4}$/.test(pin) && (await verifyPassword(pin, target.pinHash, passwordIterations(ctx.env))).ok;
  if (!ok) {
    const failed = target.failed + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      const until = ctx.now + LOCK_MINUTES * MINUTE;
      await db.prepare(`UPDATE ${table} SET ${cols.failed} = 0, ${cols.locked} = ? WHERE id = ?`).bind(until, id).run();
      await audit(db, account.id, "pin.locked", `${target.kind === "parent" ? "account" : "student"}:${id}`);
      return show(lockMessage(until, ctx.now), 429);
    }
    await db.prepare(`UPDATE ${table} SET ${cols.failed} = ? WHERE id = ?`).bind(failed, id).run();
    const left = MAX_FAILED_ATTEMPTS - failed;
    return show(left <= 2 ? `الرمز غير صحيح. بقيت ${left === 1 ? "محاولة واحدة" : "محاولتان"}.` : "الرمز غير صحيح.");
  }
  await db.prepare(`UPDATE ${table} SET ${cols.failed} = 0, ${cols.locked} = NULL WHERE id = ?`).bind(id).run();
  return enter(ctx, target);
}

// ---------- صفحة الابن وصفحة الولي ----------

async function getStudentHome(ctx: Ctx): Promise<Response> {
  const { session, account } = ctx.user!;
  if (session.profile_kind !== "student") return redirect(session.profile_kind === "parent" ? "/account" : "/profiles");
  const target = await loadTarget(ctx, account, "student", String(session.student_id ?? ""));
  if (!target) {
    // الابن أُوقف أو حُذف بعد اختيار ملفه
    await setProfile(ctx.env.DB, session.id, null, null);
    return redirect("/profiles");
  }
  const subs = await ctx.env.DB.prepare("SELECT * FROM subscriptions WHERE student_id = ?").bind(target.student!.id).all<Subscription>();
  return page(studentHomePage(ctx.view, target.student!, subscriptionStatus(subs.results, target.student!.level, ctx.now)));
}

function requireParentProfile(ctx: Ctx): Response | null {
  const kind = ctx.user!.session.profile_kind;
  if (kind === "parent") return null;
  // الابن لا يرى صفحة الولي: يعود إلى صفحته، ومنها يستطيع تبديل الملف
  return redirect(kind === "student" ? "/home" : "/profiles");
}

async function getParent(ctx: Ctx): Promise<Response> {
  const blocked = requireParentProfile(ctx);
  if (blocked) return blocked;
  const { account } = ctx.user!;
  const devices = await ctx.env.DB
    .prepare("SELECT * FROM devices WHERE account_id = ? AND status != 'revoked' ORDER BY id")
    .bind(account.id)
    .all<Device>();
  const students = await activeStudents(ctx, account.id);
  const subs = await ctx.env.DB
    .prepare("SELECT s.* FROM subscriptions s JOIN students st ON st.id = s.student_id WHERE st.account_id = ? AND st.status = 'active'")
    .bind(account.id)
    .all<Subscription>();
  // التوصيات: الدورات التي فيها دروس منشورة، ولا يشترك فيها أي ابن حاليًا
  const held = (slug: string) =>
    students.some((st) => {
      const state = subscriptionStatus(subs.results.filter((x) => x.student_id === st.id), slug, ctx.now).state;
      return state === "active" || state === "due";
    });
  const courses = (await listPrograms(ctx.env.DB)).filter((p) => p.kind === "course" && p.lessons > 0 && !held(p.slug));
  const settings = await getSettings(ctx.env.DB);
  return page(
    parentPage(ctx.view, account, students, devices.results, { subs: subs.results, courses, whatsapp: settings.whatsapp, now: ctx.now }),
  );
}

// ---------- رموز الملفات ----------

async function pinProfiles(ctx: Ctx, account: Account): Promise<PinProfile[]> {
  const students = await activeStudents(ctx, account.id);
  return [
    ...students.map((s) => ({ key: `s${s.id}`, name: s.name, hasPin: Boolean(s.pin_hash) })),
    { key: "parent", name: "ملف الولي", hasPin: Boolean(account.parent_pin_hash) },
  ];
}

async function getPins(ctx: Ctx): Promise<Response> {
  const blocked = requireParentProfile(ctx);
  if (blocked) return blocked;
  const done = ctx.url.searchParams.get("done");
  return page(pinsPage(ctx.view, await pinProfiles(ctx, ctx.user!.account), { done }));
}

function weakPin(pin: string): boolean {
  return /^(\d)\1{3}$/.test(pin) || ["1234", "4321", "0123", "9876"].includes(pin);
}

async function postPins(ctx: Ctx): Promise<Response> {
  const blocked = requireParentProfile(ctx);
  if (blocked) return blocked;
  const { account } = ctx.user!;
  const db = ctx.env.DB;
  const form = await readForm(ctx.request);
  const key = field(form, "target");
  const action = field(form, "action");

  let table: "accounts" | "students";
  let id: number;
  let prefix: "parent_pin" | "pin";
  if (key === "parent") {
    table = "accounts";
    id = account.id;
    prefix = "parent_pin";
  } else {
    const target = await loadTarget(ctx, account, "student", /^s\d+$/.test(key) ? key.slice(1) : null);
    if (!target) return redirect("/account/pins");
    table = "students";
    id = target.student!.id;
    prefix = "pin";
  }
  const auditTarget = `${table === "accounts" ? "account" : "student"}:${id}`;

  if (action === "clear") {
    await db.prepare(`UPDATE ${table} SET ${prefix}_hash = NULL, ${prefix}_failed = 0, ${prefix}_locked_until = NULL WHERE id = ?`).bind(id).run();
    await audit(db, account.id, "pin.cleared", auditTarget);
    return redirect("/account/pins?done=cleared");
  }

  const pin = field(form, "pin");
  const confirm = field(form, "confirm");
  let error: string | null = null;
  if (!/^\d{4}$/.test(pin)) error = "الرمز 4 أرقام بالضبط.";
  else if (pin !== confirm) error = "الرمزان غير متطابقين.";
  else if (weakPin(pin)) error = "هذا الرمز سهل التخمين. اختر 4 أرقام أخرى.";
  if (error) {
    return page(pinsPage(ctx.view, await pinProfiles(ctx, account), { errorKey: key, error }), 400);
  }
  const hash = await hashPassword(pin, passwordIterations(ctx.env));
  await db.prepare(`UPDATE ${table} SET ${prefix}_hash = ?, ${prefix}_failed = 0, ${prefix}_locked_until = NULL WHERE id = ?`).bind(hash, id).run();
  await audit(db, account.id, "pin.set", auditTarget);
  return redirect("/account/pins?done=set");
}
