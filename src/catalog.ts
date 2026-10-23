// فهرس المستويات والدورات.
// مؤقت: بيانات تجريبية للمرحلة 1 فقط، تُستبدل بقاعدة البيانات في المرحلة 4
// حين يضيف الأستاذ المحتوى الحقيقي من لوحة التحكم.

export type ItemKind = "video" | "pdf" | "quiz";

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  free: boolean;
}

export interface Unit {
  id: string;
  title: string;
  items: Item[];
}

export interface Program {
  slug: string;
  kind: "level" | "course";
  title: string;
  short: string;
  /** ما يُكتب داخل السداسي: رقم السنة للمستويات، ورمز للدورات. */
  mark: string;
  /** المرحلة تحت الرقم: متوسط أو ثانوي أو دورة. */
  stage: string;
  units: Unit[];
}

export const KIND_LABELS: Record<ItemKind, string> = {
  video: "فيديو",
  pdf: "ملف PDF",
  quiz: "اختبار",
};

function sampleUnits(slug: string, count: number, word: string): Unit[] {
  return Array.from({ length: count }, (_, u) => {
    const n = u + 1;
    const id = `${slug}-u${n}`;
    const items: Item[] =
      n === 1
        ? [
            { id: `${id}-i1`, kind: "video", title: "درس تجريبي مجاني", free: true },
            { id: `${id}-i2`, kind: "pdf", title: "ملخص تجريبي مجاني", free: true },
            { id: `${id}-i3`, kind: "video", title: "درس تجريبي مدفوع", free: false },
            { id: `${id}-i4`, kind: "quiz", title: "اختبار تجريبي", free: false },
          ]
        : [
            { id: `${id}-i1`, kind: "video", title: "درس تجريبي", free: false },
            { id: `${id}-i2`, kind: "pdf", title: "ملخص تجريبي", free: false },
            { id: `${id}-i3`, kind: "quiz", title: "اختبار تجريبي", free: false },
          ];
    return { id, title: `${word} ${n}`, items };
  });
}

function level(slug: string, title: string, short: string, mark: string, stage: string): Program {
  return { slug, kind: "level", title, short, mark, stage, units: sampleUnits(slug, 7, "المقطع") };
}

function course(slug: string, title: string, mark: string): Program {
  return { slug, kind: "course", title, short: "دورة", mark, stage: "دورة", units: sampleUnits(slug, 3, "الجزء") };
}

export const PROGRAMS: readonly Program[] = [
  level("1am", "السنة الأولى متوسط", "1 متوسط", "1", "متوسط"),
  level("2am", "السنة الثانية متوسط", "2 متوسط", "2", "متوسط"),
  level("3am", "السنة الثالثة متوسط", "3 متوسط", "3", "متوسط"),
  level("4am", "السنة الرابعة متوسط", "4 متوسط", "4", "متوسط"),
  level("1as", "السنة الأولى ثانوي", "1 ثانوي", "1", "ثانوي"),
  course("mental-math", "الحساب الذهني", "×÷"),
  course("olympiad", "تحضير الأولمبياد", "∑"),
];

export function findProgram(slug: string): Program | undefined {
  return PROGRAMS.find((p) => p.slug === slug);
}

export function findItem(
  id: string,
): { program: Program; unit: Unit; item: Item } | undefined {
  for (const program of PROGRAMS) {
    for (const unit of program.units) {
      const item = unit.items.find((i) => i.id === id);
      if (item) return { program, unit, item };
    }
  }
  return undefined;
}

export function countItems(program: Program): { total: number; free: number } {
  let total = 0;
  let free = 0;
  for (const unit of program.units) {
    for (const item of unit.items) {
      total++;
      if (item.free) free++;
    }
  }
  return { total, free };
}
