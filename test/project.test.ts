import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("الصفحة الرئيسية عربية ومن اليمين إلى اليسار", () => {
  const html = read("public/index.html");
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
});

test("الصفحة الرئيسية تعرض اسم المنصة وشعارها", () => {
  const html = read("public/index.html");
  assert.match(html, /<title>الأستاذ زين الدين للرياضيات<\/title>/);
  assert.match(html, /الرياضيات كما يجب أن تكون/);
});

test("موقع الاختبار منفصل عن الموقع الحقيقي في الإعدادات", () => {
  const config = read("wrangler.toml");
  assert.match(config, /^name = "zinou-math"$/m);
  assert.match(config, /\[env\.staging\]\s*\nname = "zinou-math-staging"/);
  assert.match(config, /APP_ENV = "staging"/);
});

test("ملفات الأسرار المحلية مستبعدة من المستودع", () => {
  const ignore = read(".gitignore").split("\n");
  for (const entry of [".dev.vars", ".env", "node_modules/"]) {
    assert.ok(ignore.includes(entry), entry);
  }
});
