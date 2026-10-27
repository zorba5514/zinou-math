// يتأكد أن قاعدة البيانات موجودة على Cloudflare (ينشئها في أول نشر)،
// ثم يكتب معرّفها في wrangler.toml داخل بيئة النشر فقط.
// الاستعمال: node scripts/ensure-d1.mjs zinou-math-staging
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const name = process.argv[2];
if (!name) {
  console.log("::error::اسم قاعدة البيانات مطلوب");
  process.exit(1);
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function findDatabase() {
  const out = wrangler(["d1", "list", "--json"]);
  const start = out.indexOf("[");
  const list = JSON.parse(out.slice(start));
  return list.find((db) => db.name === name);
}

let db = findDatabase();
if (!db) {
  console.log(`قاعدة البيانات ${name} غير موجودة، يجري إنشاؤها...`);
  wrangler(["d1", "create", name]);
  db = findDatabase();
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
