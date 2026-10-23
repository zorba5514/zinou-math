import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { esc, html } from "../src/html.ts";
import { PROGRAMS, countItems, findItem } from "../src/catalog.ts";
import { homePage, SITE_NAME, SLOGAN } from "../src/pages.ts";
import { describe, formula, intercept, linePath, toY } from "../public/graph.js";

const root = (path: string) => new URL(`../${path}`, import.meta.url);
const read = (path: string) => readFileSync(root(path), "utf8");

test("صيغة الدالة تُكتب بشكل رياضي صحيح", () => {
  const M = "\u2212";
  assert.equal(formula(1, 2), "f(x) = x + 2");
  assert.equal(formula(-1, 0), `f(x) = ${M}x`);
  assert.equal(formula(0, 0), "f(x) = 0");
  assert.equal(formula(0, -3), `f(x) = ${M}3`);
  assert.equal(formula(2.5, -4), `f(x) = 2.5x ${M} 4`);
  assert.equal(formula(-0.5, 1), `f(x) = ${M}0.5x + 1`);
});

test("المستقيم يمر بالنقاط الصحيحة في الرسم", () => {
  // f(x) = x + 2: عند x = 0 تكون f(x) = 2، أي 2 مربعات فوق المبدأ.
  assert.equal(toY(2), 160 - 40);
  assert.equal(linePath(0, 0), "M0 160L320 160");
  assert.equal(linePath(1, 0), "M0 320L320 0");
  assert.match(describe(1), /صاعد/);
  assert.match(describe(-2), /نازل/);
  assert.match(describe(0), /أفقي/);
  assert.equal(intercept(-3), "(0 ; \u22123)");
});

test("الصفحة الرئيسية تعرض الشعار واسم المنصة والعبارة", () => {
  const page = homePage("staging");
  assert.match(page, /<html lang="ar" dir="rtl">/);
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(page, /src="\/brand\/logo.svg"/);
  assert.ok(page.includes(`<title>${SITE_NAME}</title>`));
  assert.ok(page.includes(SLOGAN));
});

test("الصفحات لا تحتوي تنسيقًا أو كودًا مضمّنًا تمنعه سياسة المحتوى", () => {
  const page = homePage("staging");
  for (const tag of page.match(/<script[^>]*>/g) ?? []) {
    assert.match(tag, /src="\/app\.js"/, tag);
  }
  assert.doesNotMatch(page, /<script[^>]*>[^<]+<\/script>/);
  assert.doesNotMatch(page, /<style/);
  assert.doesNotMatch(page, /\sstyle="/);
});

test("الرسم التفاعلي: الصفحة تُظهر الدالة والمستقيم، والمؤشرات مخفية حتى يعمل الكود", () => {
  const page = homePage("staging");
  assert.match(page, /data-graph/);
  assert.match(page, /f\(x\) = x \+ 2/);
  assert.match(page, /<div class="controls" data-controls hidden>/);
});

test("ملفات الهوية موجودة", () => {
  for (const file of [
    "public/brand/logo.svg",
    "public/favicon.svg",
    "public/brand/apple-touch-icon.png",
    "public/brand/icon-192.png",
    "public/brand/icon-512.png",
    "public/styles.css",
    "public/app.js",
    "public/graph.js",
    "scripts/copy-fonts.mjs",
  ]) {
    assert.ok(existsSync(root(file)), file);
  }
  const css = read("public/styles.css");
  assert.match(css, /--marker: #fec101/);
  assert.match(css, /--ink: #181818/);
});

test("القوالب تهرّب النصوص فلا تتحول إلى كود", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  const name = "<script>alert(1)</script>";
  assert.equal(html`<p>${name}</p>`.value, "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal(html`<p>${html`<b>ok</b>`}</p>`.value, "<p><b>ok</b></p>");
});

test("الفهرس: 5 مستويات بسبعة مقاطع ودورتان، والمعرّفات فريدة", () => {
  const levels = PROGRAMS.filter((p) => p.kind === "level");
  assert.equal(levels.length, 5);
  assert.ok(levels.every((p) => p.units.length === 7));
  assert.equal(PROGRAMS.filter((p) => p.kind === "course").length, 2);
  const ids = PROGRAMS.flatMap((p) => p.units.flatMap((u) => u.items.map((i) => i.id)));
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PROGRAMS) {
    const { free, total } = countItems(p);
    assert.ok(free > 0 && free < total, p.slug);
  }
  assert.equal(findItem("1am-u1-i1")?.item.free, true);
  assert.equal(findItem("1am-u1-i3")?.item.free, false);
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
