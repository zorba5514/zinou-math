// المحتوى: المستويات والدورات، والمقاطع، والدروس، وقاعدة من يحق له فتح الدرس.
// المستويات الخمسة ثابتة في الكود أيضًا لأن مستوى كل ابن يرتبط بها.

import type { D1Database } from "./db.ts";
import type { Viewer } from "./ui.ts";

export const LEVELS = [
  { slug: "1am", title: "السنة الأولى متوسط", short: "1 متوسط" },
  { slug: "2am", title: "السنة الثانية متوسط", short: "2 متوسط" },
  { slug: "3am", title: "السنة الثالثة متوسط", short: "3 متوسط" },
  { slug: "4am", title: "السنة الرابعة متوسط", short: "4 متوسط" },
  { slug: "1as", title: "السنة الأولى ثانوي", short: "1 ثانوي" },
] as const;

export function levelTitle(slug: string): string {
  return LEVELS.find((l) => l.slug === slug)?.title ?? slug;
}

export function isLevel(slug: string): boolean {
  return LEVELS.some((l) => l.slug === slug);
}

export type ProgramIcon = "level" | "calculator" | "trophy";
export type Status = "draft" | "published";
export type LessonKind = "video" | "pdf";
export type FileMode = "view" | "download" | "both";

export interface Program {
  slug: string;
  kind: "level" | "course";
  title: string;
  short: string;
  icon: ProgramIcon;
  position: number;
}

export interface ProgramSummary extends Program {
  units: number;
  lessons: number;
  free: number;
}

export interface Unit {
  id: number;
  program_slug: string;
  title: string;
  position: number;
  status: Status;
  playlist_id: string | null;
  playlist_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Lesson {
  id: number;
  unit_id: number;
  kind: LessonKind;
  title: string;
  description: string | null;
  position: number;
  free: number;
  status: Status;
  youtube_id: string | null;
  file_key: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mode: FileMode | null;
  created_at: number;
  updated_at: number;
}

export interface UnitWithLessons extends Unit {
  lessons: Lesson[];
}

export const KIND_LABELS: Record<LessonKind, string> = { video: "فيديو", pdf: "ملف PDF" };

/** اسم الجزء حسب النوع: «مقطع» في المستويات و«جزء» في الدورات. */
export function unitWord(program: Pick<Program, "kind">, plural = false): string {
  if (program.kind === "level") return plural ? "مقاطع" : "المقطع";
  return plural ? "أجزاء" : "الجزء";
}

/** حجم الملف بصيغة مقروءة: KB تحت الميغابايت، وMB فوقه. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- القراءة ----------

/**
 * كل المستويات والدورات مع عدد ما هو منشور فيها.
 * المسودات لا تُحسب إلا إذا طُلب ذلك (للوحة التحكم).
 */
export async function listPrograms(db: D1Database, opts: { drafts?: boolean } = {}): Promise<ProgramSummary[]> {
  const pub = opts.drafts ? "" : "AND u.status = 'published'";
  const lpub = opts.drafts ? "" : "AND l.status = 'published'";
  const r = await db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM units u WHERE u.program_slug = p.slug ${pub}) AS units,
         (SELECT COUNT(*) FROM lessons l JOIN units u ON u.id = l.unit_id WHERE u.program_slug = p.slug ${pub} ${lpub}) AS lessons,
         (SELECT COUNT(*) FROM lessons l JOIN units u ON u.id = l.unit_id WHERE u.program_slug = p.slug AND l.free = 1 ${pub} ${lpub}) AS free
       FROM programs p ORDER BY p.position, p.slug`,
    )
    .all<ProgramSummary>();
  return r.results;
}

export async function getProgram(db: D1Database, slug: string): Promise<Program | null> {
  return db.prepare("SELECT * FROM programs WHERE slug = ?").bind(slug).first<Program>();
}

/** مقاطع المستوى بدروسها، مرتبة. للزوار: المنشور فقط. */
export async function programUnits(db: D1Database, slug: string, opts: { drafts?: boolean } = {}): Promise<UnitWithLessons[]> {
  const units = await db
    .prepare(`SELECT * FROM units WHERE program_slug = ? ${opts.drafts ? "" : "AND status = 'published'"} ORDER BY position, id`)
    .bind(slug)
    .all<Unit>();
  if (!units.results.length) return [];
  const ids = units.results.map((u) => u.id);
  const lessons = await db
    .prepare(
      `SELECT * FROM lessons WHERE unit_id IN (${ids.map(() => "?").join(",")}) ${opts.drafts ? "" : "AND status = 'published'"} ORDER BY position, id`,
    )
    .bind(...ids)
    .all<Lesson>();
  return units.results.map((u) => ({ ...u, lessons: lessons.results.filter((l) => l.unit_id === u.id) }));
}

export interface LessonContext {
  lesson: Lesson;
  unit: Unit;
  program: Program;
}

export async function getLesson(db: D1Database, id: number): Promise<LessonContext | null> {
  const lesson = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Lesson>();
  if (!lesson) return null;
  const unit = await db.prepare("SELECT * FROM units WHERE id = ?").bind(lesson.unit_id).first<Unit>();
  if (!unit) return null;
  const program = await getProgram(db, unit.program_slug);
  if (!program) return null;
  return { lesson, unit, program };
}

/** الدرس ظاهر للعامة: منشور، في مقطع منشور. */
export function isPublished(c: LessonContext): boolean {
  return c.lesson.status === "published" && c.unit.status === "published";
}

/**
 * من يحق له فتح الدرس (مشاهدة الفيديو أو فتح الملف).
 * المجاني للجميع. المدفوع للأستاذ فقط حاليًا؛ الاشتراكات تُضاف في المرحلة 5.
 */
export function canOpen(viewer: Viewer | null, lesson: Pick<Lesson, "free">): boolean {
  if (lesson.free) return true;
  return viewer?.role === "admin";
}
