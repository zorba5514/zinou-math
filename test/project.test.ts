import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { esc, html } from "../src/html.ts";
import { LEVELS } from "../src/content.ts";
import { createTestDb } from "./helpers/d1.ts";
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
  const page = homePage({ env: "staging", viewer: null }, []);
  assert.match(page, /<html lang="ar" dir="rtl">/);
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(page, /src="\/brand\/logo.svg"/);
  assert.ok(page.includes(`<title>${SITE_NAME}</title>`));
  assert.ok(page.includes(SLOGAN));
});

test("الصفحات لا تحتوي تنسيقًا أو كودًا مضمّنًا تمنعه سياسة المحتوى", () => {
  const page = homePage({ env: "staging", viewer: null }, []);
  for (const tag of page.match(/<script[^>]*>/g) ?? []) {
    assert.match(tag, /src="\/app\.js"/, tag);
  }
  assert.doesNotMatch(page, /<script[^>]*>[^<]+<\/script>/);
  assert.doesNotMatch(page, /<style/);
  assert.doesNotMatch(page, /\sstyle="/);
});

test("الرسم التفاعلي: الصفحة تُظهر الدالة والمستقيم، والمؤشرات معطّلة حتى يعمل الكود", () => {
  const page = homePage({ env: "staging", viewer: null }, []);
  assert.match(page, /data-graph/);
  assert.match(page, /f\(x\) = x \+ 2/);
  assert.match(page, /<div class="controls" data-controls>/);
  assert.equal(page.match(/type="range"[^>]* disabled>/g)?.length, 2);
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
  assert.match(css, /--brand: #FBBF24/);
  assert.match(css, /--ink: #16181D/);
  assert.match(css, /font-family: "Tajawal"/);
});

test("القوالب تهرّب النصوص فلا تتحول إلى كود", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  const name = "<script>alert(1)</script>";
  assert.equal(html`<p>${name}</p>`.value, "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal(html`<p>${html`<b>ok</b>`}</p>`.value, "<p><b>ok</b></p>");
});

test("المستويات الخمسة في الكود تطابق ما في قاعدة البيانات، والدورتان موجودتان", () => {
  const db = createTestDb();
  const rows = db.raw.prepare("SELECT slug, kind, title, short FROM programs ORDER BY position").all() as Record<string, string>[];
  const levels = rows.filter((r) => r.kind === "level");
  assert.deepEqual(
    levels.map((r) => ({ slug: r.slug, title: r.title, short: r.short })),
    LEVELS.map((l) => ({ slug: l.slug, title: l.title, short: l.short })),
  );
  assert.deepEqual(rows.filter((r) => r.kind === "course").map((r) => r.slug), ["mental-math", "olympiad"]);
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

test("القائمة الجانبية تعمل دون كود: زر يفتحها وزر يغلقها", () => {
  const page = homePage({ env: "staging", viewer: null }, []);
  assert.match(page, /<aside id="drawer" class="drawer" popover/);
  assert.match(page, /popovertarget="drawer" aria-label="فتح القائمة"/);
  assert.match(page, /popovertargetaction="hide"/);
  assert.match(page, /class="nav-item" href="\/" aria-current="page"/);
});

test("الهوية: السداسي في الشعار فقط، والخط المتعرج مرة واحدة", () => {
  const page = homePage({ env: "staging", viewer: null }, []);
  assert.doesNotMatch(page, /polygon\(/);
  assert.doesNotMatch(read("public/styles.css"), /polygon\(/);
  assert.equal(page.match(/class="zigzag"/g)?.length, 1);
});
