// يتأكد أن قاعدة البيانات موجودة على Cloudflare (ينشئها في أول نشر في أوروبا الغربية، الأقرب إلى الجزائر)،
// ثم يكتب معرّفها في wrangler.toml داخل بيئة النشر فقط.
// الاستعمال: node scripts/ensure-d1.mjs zinou-math-staging-eu [--copy-from zinou-math-staging]
// --copy-from: عند إنشاء القاعدة لأول مرة تُنسخ إليها كل بيانات قاعدة قديمة (لنقلها إلى مكان آخر دون فقدان شيء).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

const LOCATION = "weur";
const name = process.argv[2];
const copyIndex = process.argv.indexOf("--copy-from");
const copyFrom = copyIndex > 0 ? process.argv[copyIndex + 1] : null;
if (!name) {
  console.log("::error::اسم قاعدة البيانات مطلوب");
  process.exit(1);
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function findDatabase(dbName = name) {
  const out = wrangler(["d1", "list", "--json"]);
  const start = out.indexOf("[");
  const list = JSON.parse(out.slice(start));
  return list.find((db) => db.name === dbName);
}

function tableCount(dbName) {
  const out = wrangler(["d1", "info", dbName, "--json"]);
  return Number(JSON.parse(out.slice(out.indexOf("{"))).num_tables ?? 0);
}

let db = findDatabase();
if (!db) {
  console.log(`قاعدة البيانات ${name} غير موجودة، يجري إنشاؤها في ${LOCATION}...`);
  wrangler(["d1", "create", name, "--location", LOCATION]);
  db = findDatabase();
}

// نقل البيانات من القاعدة القديمة، مرة واحدة فقط: عندما تكون الجديدة فارغة
if (db && copyFrom && findDatabase(copyFrom) && tableCount(name) === 0) {
  console.log(`نسخ البيانات من ${copyFrom} إلى ${name}...`);
  try {
    wrangler(["d1", "export", copyFrom, "--remote", "--output", "d1-copy.sql"]);
    if (!existsSync("d1-copy.sql") || statSync("d1-copy.sql").size === 0) throw new Error("ملف النسخ فارغ");
    wrangler(["d1", "execute", name, "--remote", "--file", "d1-copy.sql"]);
    console.log(`::notice title=نقل قاعدة البيانات::نُسخت بيانات ${copyFrom} إلى ${name} (${LOCATION}). القاعدة القديمة باقية دون تغيير.`);
  } catch (e) {
    // نسخ ناقص: نحذف الجديدة حتى يُعاد النسخ كاملًا في النشر التالي، ولا ننشر على قاعدة ناقصة
    console.log(`::error title=نقل قاعدة البيانات::فشل النسخ: ${String(e.message ?? e).slice(0, 300)}`);
    try {
      wrangler(["d1", "delete", name, "--skip-confirmation"]);
    } catch {}
    process.exit(1);
  }
}
if (!db?.uuid) {
  console.log(`::error::تعذّر العثور على قاعدة البيانات ${name} بعد إنشائها`);
  process.exit(1);
}

const config = readFileSync("wrangler.toml", "utf8");
const pattern = new RegExp(`(database_name = "${name}"\\s*\\n(?:#[^\\n]*\\n)*database_id = )"[^"]*"`);
if (!pattern.test(config)) {
  console.log(`::error::لم يُعثر على database_id لـ ${name} في wrangler.toml`);
  process.exit(1);
}
writeFileSync("wrangler.toml", config.replace(pattern, `$1"${db.uuid}"`));
console.log(`قاعدة البيانات ${name}: ${db.uuid}`);
// للتشخيص: مكان قاعدة البيانات (يؤثر في سرعة كل صفحة)
try {
  const info = wrangler(["d1", "info", name, "--json"]);
  const data = JSON.parse(info.slice(info.indexOf("{")));
  const where = data.running_in_region ?? data.region ?? data.primary_location_hint ?? "غير معروف";
  console.log(`::notice title=مكان قاعدة البيانات::${name}: ${where} ${JSON.stringify(data).slice(0, 400)}`);
} catch {
  console.log("تعذّر قراءة معلومات قاعدة البيانات");
}
