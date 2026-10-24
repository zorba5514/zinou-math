// اختبارات المرحلة 4: إدارة المحتوى، واستيراد قوائم يوتيوب، وحماية الدروس المدفوعة.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Browser, makeEnv, setupAdmin, type TestEnv } from "./helpers/family.ts";
import { parsePlaylistId, parseVideoId } from "../src/youtube.ts";

// ---------- يوتيوب وهمي ----------
// لا اتصال حقيقي بيوتيوب في الاختبارات: نستبدل fetch بردود جاهزة.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface FakeVideo {
  id: string;
  title: string;
  privacy?: string;
}

const youtubeCalls: string[] = [];

function fakeYoutube(playlists: Record<string, FakeVideo[]>, opts: { pageSize?: number } = {}) {
  youtubeCalls.length = 0;
  const pageSize = opts.pageSize ?? 50;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    youtubeCalls.push(url.href);
    if (url.hostname === "www.youtube.com" && url.pathname === "/oembed") {
      const id = new URL(url.searchParams.get("url") ?? "").searchParams.get("v") ?? "";
      if (id === "missingVid1") return new Response("Not Found", { status: 404 });
      // العنوان لا يحتوي المعرّف، حتى نتأكد أن المعرّف نفسه لا يظهر في الصفحات
      return Response.json({ title: `عنوان ${id.slice(0, 5)}` });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname === "/youtube/v3/playlistItems") {
      if (url.searchParams.get("key") !== "test-key") {
        return Response.json({ error: { errors: [{ reason: "keyInvalid" }] } }, { status: 400 });
      }
      const list = playlists[url.searchParams.get("playlistId") ?? ""];
      if (!list) return Response.json({ error: { errors: [{ reason: "playlistNotFound" }] } }, { status: 404 });
      const start = Number(url.searchParams.get("pageToken") || 0);
      const page = list.slice(start, start + pageSize);
      return Response.json({
        nextPageToken: start + pageSize < list.length ? String(start + pageSize) : undefined,
        items: page.map((v, i) => ({
          snippet: { title: v.title, position: start + i, resourceId: { videoId: v.id } },
          status: { privacyStatus: v.privacy ?? "unlisted" },
        })),
      });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
}

const PLAYLIST = "PLzinou1234567890abc";
const VIDEOS: FakeVideo[] = [
  { id: "vidAAAAAAA1", title: "الدرس 1: الأعداد الطبيعية" },
  { id: "vidBBBBBBB2", title: "الدرس 2: الأعداد العشرية" },
  { id: "vidCCCCCCC3", title: "Private video", privacy: "private" },
  { id: "vidDDDDDDD4", title: "الدرس 3: المقارنة" },
];

function contentEnv(withKey = true): TestEnv {
  const env = makeEnv();
  if (withKey) env.YOUTUBE_API_KEY = "test-key";
  return env;
}

function lessons(env: TestEnv, unitId: number) {
  return env.DB.raw.prepare("SELECT id, title, youtube_id, status, free, position FROM lessons WHERE unit_id = ? ORDER BY position, id").all(unitId) as {
    id: number;
    title: string;
    youtube_id: string;
    status: string;
    free: number;
    position: number;
  }[];
}

async function addUnit(admin: Browser, slug: string, fields: Record<string, string>): Promise<{ res: Response; unitId: number }> {
  const res = await admin.post(`/admin/content/${slug}/units`, fields);
  const m = /\/admin\/units\/(\d+)/.exec(res.headers.get("Location") ?? "");
  return { res, unitId: Number(m?.[1] ?? 0) };
}

// ---------- قراءة الروابط ----------

test("قراءة روابط الفيديو بكل أشكالها، ورفض غيرها", () => {
  for (const link of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
  ]) {
    assert.equal(parseVideoId(link), "dQw4w9WgXcQ", link);
  }
  for (const bad of ["https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "hello", "", "https://youtu.be/<script>"]) {
    assert.equal(parseVideoId(bad), null, bad);
  }
});

test("قراءة روابط قوائم التشغيل", () => {
  assert.equal(parsePlaylistId("https://www.youtube.com/playlist?list=PLzinou1234567890abc"), "PLzinou1234567890abc");
  assert.equal(parsePlaylistId("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLzinou1234567890abc"), "PLzinou1234567890abc");
  assert.equal(parsePlaylistId("PLzinou1234567890abc"), "PLzinou1234567890abc");
  assert.equal(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parsePlaylistId("https://evil.com/playlist?list=PLzinou1234567890abc"), null);
  assert.equal(parsePlaylistId("dQw4w9WgXcQ"), null);
});

// ---------- الصلاحيات ----------

test("صفحات إدارة المحتوى للأستاذ فقط", async () => {
  const env = contentEnv();
  const visitor = new Browser(env);
  assert.match((await visitor.get("/admin/content")).headers.get("Location") ?? "", /^\/login/);
  assert.equal((await visitor.post("/admin/content/1am/units", { title: "مقطع" })).status, 303);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM units").get()?.n, 0);
});

// ---------- استيراد قائمة تشغيل ----------

test("مقطع جديد برابط قائمة تشغيل: تُنشأ الدروس بالعناوين والترتيب كمسودات مدفوعة، والخاصة تُتخطى", async () => {
  const env = contentEnv();
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({ [PLAYLIST]: VIDEOS });
  const { res, unitId } = await addUnit(admin, "2am", { title: "المقطع 1: الأعداد", playlist: `https://www.youtube.com/playlist?list=${PLAYLIST}` });
  assert.match(res.headers.get("Location") ?? "", /added=3&existing=0&skipped=1/);
  const rows = lessons(env, unitId);
  assert.deepEqual(rows.map((r) => r.youtube_id), ["vidAAAAAAA1", "vidBBBBBBB2", "vidDDDDDDD4"]);
  assert.deepEqual(rows.map((r) => r.title), ["الدرس 1: الأعداد الطبيعية", "الدرس 2: الأعداد العشرية", "الدرس 3: المقارنة"]);
  assert.ok(rows.every((r) => r.status === "draft" && r.free === 0));
  // المفتاح لا يُطبع في الصفحة
  const page = await (await admin.get(res.headers.get("Location") ?? "")).text();
  assert.match(page, /أُضيف 3 درسًا جديدًا/);
  assert.match(page, /1 فيديو خاص أو محذوف/);
  assert.ok(!page.includes("test-key"));
});

test("تحديث القائمة يضيف الجديد فقط في آخر المقطع، ولا يغيّر العناوين المعدّلة", async () => {
  const env = contentEnv();
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({ [PLAYLIST]: VIDEOS.slice(0, 2) });
  const { unitId } = await addUnit(admin, "2am", { title: "المقطع 1", playlist: PLAYLIST });
  const first = lessons(env, unitId)[0]!;
  await admin.post(`/admin/lessons/${first.id}/edit`, { title: "عنوان عدّلته", free: "1", status: "published", unit_id: String(unitId), description: "" });

  fakeYoutube({ [PLAYLIST]: [...VIDEOS.slice(0, 2), { id: "vidEEEEEEE5", title: "درس جديد" }] });
  const sync = await admin.post(`/admin/units/${unitId}/playlist`, { playlist: `https://www.youtube.com/playlist?list=${PLAYLIST}` });
  assert.match(sync.headers.get("Location") ?? "", /added=1&existing=2/);
  const rows = lessons(env, unitId);
  assert.deepEqual(rows.map((r) => r.title), ["عنوان عدّلته", "الدرس 2: الأعداد العشرية", "درس جديد"]);
  assert.equal(rows[0]?.free, 1);
  assert.equal(rows[0]?.status, "published");
});

test("القوائم الطويلة تُقرأ صفحة بعد صفحة", async () => {
  const env = contentEnv();
  const { b: admin } = await setupAdmin(env);
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `long${String(i).padStart(7, "0")}`, title: `درس ${i + 1}` }));
  fakeYoutube({ [PLAYLIST]: many });
  const { unitId } = await addUnit(admin, "4am", { title: "مقطع طويل", playlist: PLAYLIST });
  const rows = lessons(env, unitId);
  assert.equal(rows.length, 120);
  assert.equal(rows[119]?.title, "درس 120");
  assert.equal(youtubeCalls.filter((u) => u.includes("playlistItems")).length, 3);
});

test("أخطاء الاستيراد تظهر برسالة واضحة ولا تُنشئ دروسًا", async () => {
  const env = contentEnv();
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({});
  const { unitId } = await addUnit(admin, "1am", { title: "مقطع" });
  const notFound = await admin.post(`/admin/units/${unitId}/playlist`, { playlist: "PLdoesNotExist12345" });
  assert.equal(notFound.status, 400);
  assert.match(await notFound.text(), /لم نجد قائمة التشغيل/);
  const bad = await admin.post(`/admin/units/${unitId}/playlist`, { playlist: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.match(await bad.text(), /ليس رابط قائمة تشغيل/);

  env.YOUTUBE_API_KEY = "wrong-key";
  const wrongKey = await admin.post(`/admin/units/${unitId}/playlist`, { playlist: PLAYLIST });
  assert.match(await wrongKey.text(), /رفض يوتيوب المفتاح/);

  env.YOUTUBE_API_KEY = undefined;
  const noKey = await admin.post(`/admin/units/${unitId}/playlist`, { playlist: PLAYLIST });
  assert.match(await noKey.text(), /مفتاح يوتيوب غير مضاف بعد/);
  assert.equal(lessons(env, unitId).length, 0);
});

// ---------- لصق الروابط ----------

test("لصق روابط فيديو: العنوان من يوتيوب، والتكرار والأسطر الخاطئة لا تُضاف", async () => {
  const env = contentEnv(false);
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({});
  const { unitId } = await addUnit(admin, "1am", { title: "مقطع" });
  const res = await admin.post(`/admin/units/${unitId}/videos`, {
    links: "https://youtu.be/pasteAAAA01\nhttps://www.youtube.com/watch?v=pasteBBBB02\nليس رابطًا\nhttps://youtu.be/pasteAAAA01\nhttps://youtu.be/missingVid1",
  });
  assert.match(res.headers.get("Location") ?? "", /added=3&existing=0&skipped=0&invalid=1/);
  const rows = lessons(env, unitId);
  assert.deepEqual(rows.map((r) => r.title), ["عنوان paste", "عنوان paste", "فيديو بلا عنوان (عدّل العنوان)"]);
  // لصقها مرة ثانية لا يكررها
  const again = await admin.post(`/admin/units/${unitId}/videos`, { links: "https://youtu.be/pasteAAAA01" });
  assert.match(again.headers.get("Location") ?? "", /added=0&existing=1/);
  const tooMany = await admin.post(`/admin/units/${unitId}/videos`, { links: Array.from({ length: 41 }, () => "https://youtu.be/pasteAAAA01").join("\n") });
  assert.equal(tooMany.status, 400);
  assert.match(await tooMany.text(), /أكثر من الحد/);
});

// ---------- النشر والإتاحة ----------

test("الدرس في وضع المسودة لا يظهر لأحد، والنشر يظهره، والمجاني يُفتح والمدفوع يُقفل", async () => {
  const env = contentEnv(false);
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({});
  const { unitId } = await addUnit(admin, "1am", { title: "المقطع الأول" });
  await admin.post(`/admin/units/${unitId}/videos`, { links: "https://youtu.be/freeAAAAA01\nhttps://youtu.be/paidBBBBB02" });
  const [free, paid] = lessons(env, unitId);
  const visitor = new Browser(env);

  // كل شيء مسودة: لا شيء ظاهر
  assert.doesNotMatch(await (await visitor.get("/levels/1am")).text(), /المقطع الأول/);
  assert.equal((await visitor.get(`/lessons/${free!.id}`)).status, 404);
  // الأستاذ يعاين المسودة
  assert.match(await (await admin.get(`/lessons/${free!.id}`)).text(), /معاينة: هذا الدرس مسودة/);

  // نشر الدروس دون نشر المقطع: ما زال مخفيًا
  await admin.post(`/admin/units/${unitId}/publish-all`, {});
  assert.equal((await visitor.get(`/lessons/${free!.id}`)).status, 404);

  // نشر المقطع، وجعل الأول مجانيًا
  await admin.post(`/admin/units/${unitId}/status`, {});
  await admin.post(`/admin/lessons/${free!.id}/free`, {});
  const level = await (await visitor.get("/levels/1am")).text();
  assert.match(level, /المقطع الأول/);
  assert.match(level, new RegExp(`href="/lessons/${free!.id}"`));
  assert.match(level, new RegExp(`href="/subscribe\\?lesson=${paid!.id}"`));
  assert.ok(!level.includes("freeAAAAA01") && !level.includes("paidBBBBB02"));

  assert.match(await (await visitor.get(`/lessons/${free!.id}`)).text(), /embed\/freeAAAAA01/);
  const locked = await visitor.get(`/lessons/${paid!.id}`);
  assert.equal(locked.status, 302);
  assert.ok(!(await locked.text()).includes("paidBBBBB02"));
  // الأستاذ يرى المدفوع
  assert.match(await (await admin.get(`/lessons/${paid!.id}`)).text(), /embed\/paidBBBBB02/);

  // الإخفاء يعيد كل شيء
  await admin.post(`/admin/units/${unitId}/status`, {});
  assert.equal((await visitor.get(`/lessons/${free!.id}`)).status, 404);
});

test("ولي دخل بحسابه لا يرى معرّف الفيديو المدفوع قبل الاشتراك", async () => {
  const env = contentEnv(false);
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({});
  const { unitId } = await addUnit(admin, "2am", { title: "مقطع" });
  await admin.post(`/admin/units/${unitId}/videos`, { links: "https://youtu.be/paidCCCCC03" });
  await admin.post(`/admin/units/${unitId}/publish-all`, {});
  await admin.post(`/admin/units/${unitId}/status`, {});
  const id = lessons(env, unitId)[0]!.id;
  const created = await admin.post("/admin/families/new", { name: "عائلة", phone: "0661223344", child_name_1: "ابن", child_level_1: "2am" });
  const password = /data-copy-source="password">([a-z0-9-]+)</.exec(await created.text())?.[1] ?? "";
  const parent = new Browser(env);
  await parent.post("/login", { phone: "0661223344", password });
  await parent.post("/account/password", { password: "Nouvelle-2026", confirm: "Nouvelle-2026" });
  const res = await parent.get(`/lessons/${id}`);
  assert.equal(res.status, 302);
  assert.ok(!(await (await parent.get("/levels/2am")).text()).includes("paidCCCCC03"));
});

// ---------- الترتيب والتعديل والحذف ----------

test("ترتيب الدروس والمقاطع، ونقل درس إلى مقطع آخر، والحذف بتأكيد", async () => {
  const env = contentEnv(false);
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({});
  const { unitId: u1 } = await addUnit(admin, "3am", { title: "المقطع أ" });
  const { unitId: u2 } = await addUnit(admin, "3am", { title: "المقطع ب" });
  await admin.post(`/admin/units/${u1}/videos`, { links: "https://youtu.be/orderAAAA01\nhttps://youtu.be/orderBBBB02\nhttps://youtu.be/orderCCCC03" });
  let rows = lessons(env, u1);
  await admin.post(`/admin/lessons/${rows[2]!.id}/move`, { dir: "up" });
  assert.deepEqual(lessons(env, u1).map((r) => r.youtube_id), ["orderAAAA01", "orderCCCC03", "orderBBBB02"]);
  // الأول لا يتقدم أكثر
  await admin.post(`/admin/lessons/${rows[0]!.id}/move`, { dir: "up" });
  assert.equal(lessons(env, u1)[0]?.youtube_id, "orderAAAA01");

  // ترتيب المقاطع
  await admin.post(`/admin/units/${u2}/move`, { dir: "up" });
  const order = env.DB.raw.prepare("SELECT id FROM units WHERE program_slug = '3am' ORDER BY position").all() as { id: number }[];
  assert.deepEqual(order.map((r) => r.id), [u2, u1]);

  // نقل درس إلى المقطع ب
  rows = lessons(env, u1);
  await admin.post(`/admin/lessons/${rows[0]!.id}/edit`, { title: rows[0]!.title, free: "0", status: "draft", unit_id: String(u2), description: "" });
  assert.equal(lessons(env, u2).length, 1);
  // لا نقل إلى مقطع في مستوى آخر
  const { unitId: other } = await addUnit(admin, "1am", { title: "مستوى آخر" });
  const refused = await admin.post(`/admin/lessons/${rows[1]!.id}/edit`, { title: "x y", free: "0", status: "draft", unit_id: String(other), description: "" });
  assert.equal(refused.status, 400);

  // الحذف يحتاج التأكيد
  assert.equal((await admin.post(`/admin/units/${u1}/delete`, {})).status, 400);
  assert.equal(lessons(env, u1).length, 2);
  await admin.post(`/admin/units/${u1}/delete`, { confirm: "1" });
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ?").get(u1)?.n, 0);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM units WHERE id = ?").get(u1)?.n, 0);
});

test("إضافة دورة جديدة وتسميتها، وتظهر في الموقع", async () => {
  const env = contentEnv(false);
  const { b: admin } = await setupAdmin(env);
  const res = await admin.post("/admin/content/courses", { title: "تحضير شهادة التعليم المتوسط", icon: "trophy" });
  const slug = /\/admin\/content\/([a-z0-9-]+)/.exec(res.headers.get("Location") ?? "")?.[1] ?? "";
  assert.match(slug, /^course-/);
  assert.match(await (await new Browser(env).get("/levels")).text(), /تحضير شهادة التعليم المتوسط/);
  await admin.post(`/admin/content/${slug}/edit`, { title: "تحضير البيام" });
  assert.equal(env.DB.raw.prepare("SELECT title FROM programs WHERE slug = ?").get(slug)?.title, "تحضير البيام");
  // المستويات لا تُعدَّل ولا تُحذف
  assert.equal((await admin.post("/admin/content/1am/delete", {})).status, 404);
  assert.equal((await admin.post("/admin/content/1am/edit", { title: "x" })).status, 404);
  await admin.post(`/admin/content/${slug}/delete`, {});
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM programs WHERE slug = ?").get(slug)?.n, 0);
});

test("النصوص التي يكتبها الأستاذ تُهرَّب في كل الصفحات", async () => {
  const env = contentEnv(false);
  const { b: admin } = await setupAdmin(env);
  fakeYoutube({});
  const { unitId } = await addUnit(admin, "1am", { title: "<script>alert(1)</script>" });
  const page = await (await admin.get(`/admin/units/${unitId}`)).text();
  assert.ok(!page.includes("<script>alert(1)</script>"));
  assert.match(page, /&lt;script&gt;/);
});
