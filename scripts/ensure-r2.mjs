// يتأكد أن مخزن الملفات (R2) موجود على Cloudflare، وينشئه في أول نشر.
// إن لم يكن R2 مفعّلًا في الحساب بعد (أو لا يملك مفتاح النشر صلاحيته)، يُحذف ربط المخزن
// من wrangler.toml لهذا النشر فقط، فيعمل الموقع دون رفع ملفات PDF، مع تنبيه في صفحة التشغيل.
// الاستعمال: node scripts/ensure-r2.mjs zinou-math-staging-files
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const name = process.argv[2];
if (!name) {
  console.log("::error::اسم المخزن مطلوب");
  process.exit(1);
}

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function detach(reason) {
  const config = readFileSync("wrangler.toml", "utf8");
  const pattern = new RegExp(`\\[\\[env\\.staging\\.r2_buckets\\]\\]\\s*\\nbinding = "FILES"\\s*\\nbucket_name = "${name}"\\s*\\n?`);
  if (!pattern.test(config)) {
    console.log(`::error::لم يُعثر على ربط المخزن ${name} في wrangler.toml`);
    process.exit(1);
  }
  writeFileSync("wrangler.toml", config.replace(pattern, ""));
  console.log(`::warning title=مخزن الملفات::${reason} الموقع يُنشر بدون رفع ملفات PDF حتى يُفعَّل R2.`);
  process.exit(0);
}

let list;
try {
  list = wrangler(["r2", "bucket", "list"]);
} catch (e) {
  const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  const hint = /10042|enable R2|not enabled/i.test(text)
    ? "R2 غير مفعّل في حساب Cloudflare."
    : /10000|Authentication|permission|Unauthorized/i.test(text)
      ? "مفتاح النشر لا يملك صلاحية Workers R2 Storage."
      : "تعذّر الوصول إلى R2.";
  detach(hint);
}

if (new RegExp(`name:\\s+${name}\\b`).test(list)) {
  console.log(`مخزن الملفات ${name} موجود`);
} else {
  console.log(`مخزن الملفات ${name} غير موجود، يجري إنشاؤه...`);
  try {
    wrangler(["r2", "bucket", "create", name]);
    console.log(`أُنشئ مخزن الملفات ${name}`);
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    if (/already exists/i.test(text)) console.log(`مخزن الملفات ${name} موجود`);
    else detach("تعذّر إنشاء مخزن الملفات.");
  }
}
