// ينسخ ملفات الخطوط العربية من حزم Fontsource إلى public/fonts قبل النشر.
// الخطوط لا تُحفظ في المستودع، بل تُجلب عند كل نشر بنفس الإصدار.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/fonts";
const FONTS = [
  { out: "plex-ar-400.woff2", pkg: "@fontsource/ibm-plex-sans-arabic", file: "ibm-plex-sans-arabic-arabic-400-normal.woff2" },
  { out: "plex-lat-400.woff2", pkg: "@fontsource/ibm-plex-sans-arabic", file: "ibm-plex-sans-arabic-latin-400-normal.woff2" },
  { out: "plex-ar-600.woff2", pkg: "@fontsource/ibm-plex-sans-arabic", file: "ibm-plex-sans-arabic-arabic-600-normal.woff2" },
  { out: "plex-lat-600.woff2", pkg: "@fontsource/ibm-plex-sans-arabic", file: "ibm-plex-sans-arabic-latin-600-normal.woff2" },
  { out: "kufi-ar.woff2", pkg: "@fontsource-variable/reem-kufi", file: "reem-kufi-arabic-wght-normal.woff2" },
  { out: "kufi-lat.woff2", pkg: "@fontsource-variable/reem-kufi", file: "reem-kufi-latin-wght-normal.woff2" },
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
