// ينسخ ملفات الخطوط العربية من حزم Fontsource إلى public/fonts قبل النشر.
// الخطوط لا تُحفظ في المستودع، بل تُجلب عند كل نشر بنفس الإصدار.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/fonts";
const FONTS = [
  { out: "tajawal-ar-400.woff2", pkg: "@fontsource/tajawal", file: "tajawal-arabic-400-normal.woff2" },
  { out: "tajawal-lat-400.woff2", pkg: "@fontsource/tajawal", file: "tajawal-latin-400-normal.woff2" },
  { out: "tajawal-ar-500.woff2", pkg: "@fontsource/tajawal", file: "tajawal-arabic-500-normal.woff2" },
  { out: "tajawal-lat-500.woff2", pkg: "@fontsource/tajawal", file: "tajawal-latin-500-normal.woff2" },
  { out: "tajawal-ar-700.woff2", pkg: "@fontsource/tajawal", file: "tajawal-arabic-700-normal.woff2" },
  { out: "tajawal-lat-700.woff2", pkg: "@fontsource/tajawal", file: "tajawal-latin-700-normal.woff2" },
  { out: "tajawal-ar-800.woff2", pkg: "@fontsource/tajawal", file: "tajawal-arabic-800-normal.woff2" },
  { out: "tajawal-lat-800.woff2", pkg: "@fontsource/tajawal", file: "tajawal-latin-800-normal.woff2" },
];

mkdirSync(OUT, { recursive: true });
const missing = [];
for (const font of FONTS) {
  const dir = join("node_modules", font.pkg, "files");
  const src = join(dir, font.file);
  if (!existsSync(src)) {
    const available = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".woff2")).slice(0, 12) : ["(الحزمة غير مثبتة)"];
    missing.push(`${font.file} غير موجود. المتوفر: ${available.join(", ")}`);
    continue;
  }
  copyFileSync(src, join(OUT, font.out));
  console.log(`${font.out} ← ${font.pkg}`);
}
if (missing.length) {
  console.log(`::error title=الخطوط::${missing.join("%0A")}`);
  process.exit(1);
}
