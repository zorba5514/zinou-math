// قارئ صغير لملفات Excel (.xlsx) داخل الخادم، دون مكتبات خارجية.
//
// ملف xlsx هو أرشيف zip فيه ملفات XML. نقرأ منه فقط ما نحتاجه: النصوص المشتركة، وأسماء الأوراق،
// وخلايا ورقة واحدة. فك الضغط بـ DecompressionStream المدمجة في Cloudflare Workers.
// حماية: حد لحجم الملف، ولحجم كل جزء بعد فك الضغط (ضد «قنابل zip»)، ولعدد الصفوف والأعمدة.

export const MAX_XLSX_BYTES = 2 * 1024 * 1024;
const MAX_PART_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_COLS = 30;

export class XlsxError extends Error {}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function u16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u32(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

/** يقرأ فهرس الأرشيف (central directory). */
function readZipIndex(b: Uint8Array): Map<string, ZipEntry> {
  // نهاية الفهرس: آخر 22 بايت على الأقل، وقد يسبقها تعليق حتى 64 كيلوبايت
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("الملف ليس ملف Excel (xlsx).");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count && n < 2000; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new XlsxError("ملف Excel تالف.");
    const method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(b: Uint8Array, e: ZipEntry): Promise<string> {
  if (e.size > MAX_PART_BYTES) throw new XlsxError("الملف كبير جدًا بعد فك الضغط.");
  const p = e.offset;
  if (p + 30 > b.length || u32(b, p) !== 0x04034b50) throw new XlsxError("ملف Excel تالف.");
  const start = p + 30 + u16(b, p + 26) + u16(b, p + 28);
  const data = b.subarray(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new XlsxError("طريقة ضغط غير مدعومة في ملف Excel.");
  const stream = new Blob([data.slice() as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // لا نصدّق الحجم المعلن: نوقف القراءة إن تجاوز الحد فعليًا
      if (total > MAX_PART_BYTES) {
        await reader.cancel();
        throw new XlsxError("الملف كبير جدًا بعد فك الضغط.");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw new XlsxError("ملف Excel تالف.");
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]!) : null;
}

/** نص عنصر قد يتكون من مقاطع منسقة (<r><t>..</t></r>)؛ نتجاهل النطق المرافق (rPh). */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]!);
  return out;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Sheet {
  name: string;
  /** الصفوف بترتيبها: row رقم الصف في Excel (يبدأ من 1)، وcells النصوص حسب العمود (A = 0) */
  rows: { row: number; cells: string[] }[];
}

/**
 * يقرأ ورقة من ملف xlsx: الورقة التي تحمل الاسم المطلوب إن وُجدت، وإلا الأولى.
 * كل القيم تُرجع نصوصًا كما تظهر تقريبًا (الأرقام بنقطة عشرية).
 */
export async function readSheet(bytes: Uint8Array, preferred?: string): Promise<Sheet> {
  if (bytes.length > MAX_XLSX_BYTES) throw new XlsxError("الملف أكبر من 2 ميغابايت.");
  const zip = readZipIndex(bytes);
  const get = async (name: string) => {
    const e = zip.get(name);
    return e ? readEntry(bytes, e) : null;
  };
  const workbook = await get("xl/workbook.xml");
  const rels = await get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new XlsxError("الملف ليس ملف Excel (xlsx).");

  const sheets = [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => ({ name: attr(m[1]!, "name") ?? "", rid: attr(m[1]!, "r:id") ?? "" }));
  if (!sheets.length) throw new XlsxError("لا توجد أوراق في الملف.");
  const chosen = sheets.find((s) => s.name.trim() === preferred) ?? sheets[0]!;
  const rel = [...rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map((m) => m[1]!).find((a) => attr(a, "Id") === chosen.rid);
  let target = rel ? (attr(rel, "Target") ?? "") : "";
  target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetXml = await get(target.replace(/\/\.\//g, "/"));
  if (!sheetXml) throw new XlsxError("تعذرت قراءة ورقة الأسئلة.");

  const sharedXml = await get("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)) : [];

  const rows: Sheet["rows"] = [];
  for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNum = Number(attr(rm[1]!, "r") ?? rows.length + 1);
    if (rows.length >= MAX_ROWS) throw new XlsxError(`الملف فيه أكثر من ${MAX_ROWS} صف.`);
    const cells: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]!;
      const ref = attr(a, "r");
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      if (col < 0 || col >= MAX_COLS) continue;
      const body = cm[2] ?? "";
      const type = attr(a, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = decodeXml(v);
      cells[col] = value;
    }
    rows.push({ row: rowNum, cells: Array.from(cells, (c) => (c ?? "").trim()) });
  }
  return { name: chosen.name, rows };
}
