// يقرأ نتائج Lighthouse ويفشل إذا قلّ الأداء أو سهولة الاستعمال عن 90 من 100.
// يُستعمل في GitHub Actions بعد النشر على موقع الاختبار.
import { readFileSync } from "node:fs";

const REQUIRED = { performance: 90, accessibility: 90 };
const files = process.argv.slice(2);
let failed = false;
const lines = [];

for (const file of files) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  const scores = Object.fromEntries(
    Object.entries(report.categories).map(([id, c]) => [id, Math.round((c.score ?? 0) * 100)]),
  );
  lines.push(`${report.finalDisplayedUrl}: ${Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const [id, min] of Object.entries(REQUIRED)) {
    if ((scores[id] ?? 0) < min) {
      failed = true;
      lines.push(`  أقل من المطلوب: ${id} = ${scores[id]} (المطلوب ${min})`);
    }
  }
}

const text = lines.join("%0A");
console.log(failed ? `::error title=Lighthouse::${text}` : `::notice title=Lighthouse::${text}`);
process.exit(failed ? 1 : 0);
