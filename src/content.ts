// المحتوى: المستويات والدورات، والمقاطع، والدروس. قاعدة من يحق له فتح الدرس في subscriptions.ts.
// المستويات الخمسة ثابتة في الكود أيضًا لأن مستوى كل ابن يرتبط بها.

import type { D1Database } from "./db.ts";

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
export type LessonKind = "video" | "pdf" | "quiz";
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
  published_at: number | null;
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
  quiz_id: number | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface UnitWithLessons extends Unit {
  lessons: Lesson[];
}

export const KIND_LABELS: Record<LessonKind, string> = { video: "فيديو", pdf: "ملف PDF", quiz: "اختبار" };

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
  return (await programWithUnits(db, slug, opts))?.units ?? [];
}

/** المستوى ومقاطعه ودروسه في رحلة واحدة إلى قاعدة البيانات. */
export async function programWithUnits(
  db: D1Database,
  slug: string,
  opts: { drafts?: boolean } = {},
): Promise<{ program: Program; units: UnitWithLessons[] } | null> {
  const unitFilter = opts.drafts ? "" : "AND status = 'published'";
  const [pRes, uRes, lRes] = await db.batch([
    db.prepare("SELECT * FROM programs WHERE slug = ?").bind(slug),
    db.prepare(`SELECT * FROM units WHERE program_slug = ? ${unitFilter} ORDER BY position, id`).bind(slug),
    db
      .prepare(
        `SELECT * FROM lessons WHERE unit_id IN (SELECT id FROM units WHERE program_slug = ? ${unitFilter})
         ${opts.drafts ? "" : "AND status = 'published'"} ORDER BY position, id`,
      )
      .bind(slug),
  ]);
  const program = pRes?.results[0] as unknown as Program | undefined;
  if (!program) return null;
  const units = (uRes?.results ?? []) as unknown as Unit[];
  const lessons = (lRes?.results ?? []) as unknown as Lesson[];
  return { program, units: units.map((u) => ({ ...u, lessons: lessons.filter((l) => l.unit_id === u.id) })) };
}

export interface LessonContext {
  lesson: Lesson;
  unit: Unit;
  program: Program;
}

export async function getLesson(db: D1Database, id: number): Promise<LessonContext | null> {
  // الدرس ومقطعه ومستواه في رحلة واحدة
  const [lRes, uRes, pRes] = await db.batch([
    db.prepare("SELECT * FROM lessons WHERE id = ?").bind(id),
    db.prepare("SELECT * FROM units WHERE id = (SELECT unit_id FROM lessons WHERE id = ?)").bind(id),
    db.prepare("SELECT * FROM programs WHERE slug = (SELECT u.program_slug FROM units u JOIN lessons l ON l.unit_id = u.id WHERE l.id = ?)").bind(id),
  ]);
  const lesson = lRes?.results[0] as unknown as Lesson | undefined;
  const unit = uRes?.results[0] as unknown as Unit | undefined;
  const program = pRes?.results[0] as unknown as Program | undefined;
  return lesson && unit && program ? { lesson, unit, program } : null;
}

/** الدرس ظاهر للعامة: منشور، في مقطع منشور. */
export function isPublished(c: LessonContext): boolean {
  return c.lesson.status === "published" && c.unit.status === "published";
}
