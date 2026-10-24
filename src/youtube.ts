// يوتيوب: قراءة روابط الفيديو وقوائم التشغيل، وجلب العناوين.
// - عنوان فيديو واحد: خدمة oEmbed العامة من يوتيوب، دون مفتاح.
// - قائمة تشغيل كاملة: YouTube Data API v3 بمفتاح سري (YOUTUBE_API_KEY) لا يظهر في الكود.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,64}$/;

/** يستخرج معرّف الفيديو من أي شكل لرابط يوتيوب، أو من المعرّف نفسه. */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** يستخرج معرّف قائمة التشغيل من رابطها (list=...) أو من المعرّف نفسه. */
export function parsePlaylistId(input: string): string | null {
  const text = input.trim();
  if (PLAYLIST_ID.test(text) && !VIDEO_ID.test(text)) return text;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") return null;
    const list = url.searchParams.get("list");
    return list && PLAYLIST_ID.test(list) ? list : null;
  } catch {
    return null;
  }
}

/** عنوان الفيديو من oEmbed. يعمل مع الفيديوهات غير المدرجة. null إن تعذّر. */
export async function videoTitle(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

export interface PlaylistVideo {
  id: string;
  title: string;
  position: number;
}

export type PlaylistResult =
  | { ok: true; videos: PlaylistVideo[]; skipped: number }
  | { ok: false; error: "no_key" | "not_found" | "bad_key" | "quota" | "network" };

/** أقصى عدد صفحات (50 فيديو لكل صفحة) في الاستيراد الواحد. */
const MAX_PAGES = 10;

/**
 * كل فيديوهات قائمة التشغيل بترتيبها. الفيديوهات الخاصة والمحذوفة تُتخطى وتُحسب في skipped.
 * القوائم العامة وغير المدرجة تعمل؛ القوائم الخاصة لا يمكن قراءتها بالمفتاح.
 */
export async function playlistVideos(playlistId: string, apiKey: string | undefined): Promise<PlaylistResult> {
  if (!apiKey) return { ok: false, error: "no_key" };
  const videos: PlaylistVideo[] = [];
  let skipped = 0;
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    } catch {
      return { ok: false, error: "network" };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason ?? "";
      if (res.status === 404 || reason === "playlistNotFound") return { ok: false, error: "not_found" };
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return { ok: false, error: "quota" };
      if (res.status === 400 || res.status === 403) return { ok: false, error: "bad_key" };
      return { ok: false, error: "network" };
    }
    const data = (await res.json()) as {
      nextPageToken?: string;
      items?: {
        snippet?: { title?: string; position?: number; resourceId?: { videoId?: string } };
        status?: { privacyStatus?: string };
      }[];
    };
    for (const item of data.items ?? []) {
      const id = item.snippet?.resourceId?.videoId ?? "";
      const title = (item.snippet?.title ?? "").trim();
      const privacy = item.status?.privacyStatus;
      if (!VIDEO_ID.test(id) || privacy === "private" || privacy === "privacyStatusUnspecified" || !title || title === "Private video" || title === "Deleted video") {
        skipped++;
        continue;
      }
      videos.push({ id, title: title.slice(0, 200), position: item.snippet?.position ?? videos.length });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  videos.sort((a, b) => a.position - b.position);
  return { ok: true, videos, skipped };
}

export const PLAYLIST_ERRORS: Record<Exclude<PlaylistResult, { ok: true }>["error"], string> = {
  no_key: "مفتاح يوتيوب غير مضاف بعد. أضفه في أسرار GitHub باسم YOUTUBE_API_KEY، أو أضف الفيديوهات بلصق روابطها.",
  not_found: "لم نجد قائمة التشغيل. تأكد من الرابط، وأن القائمة «عامة» أو «غير مدرجة» وليست «خاصة».",
  bad_key: "رفض يوتيوب المفتاح. تأكد أن YouTube Data API v3 مفعّلة في مشروع Google وأن المفتاح منسوخ كاملًا.",
  quota: "تجاوزنا الحد اليومي المجاني لطلبات يوتيوب. حاول غدًا.",
  network: "تعذّر الاتصال بيوتيوب الآن. حاول بعد قليل.",
};
