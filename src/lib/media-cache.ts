import type { LinkItem, OgData } from "@/types/link";

export type CachedMedia =
  | { type: "video"; videoUrl: string; thumbnail?: string }
  | { type: "image"; ogData: OgData }
  | null;

const MAX_CONCURRENT = 2;

const cache = new Map<string, Promise<CachedMedia>>();
const queue: Array<() => void> = [];
let active = 0;

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    const tryRun = () => {
      if (active < MAX_CONCURRENT) {
        active++;
        resolve();
      } else {
        queue.push(tryRun);
      }
    };
    tryRun();
  });
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

async function resolveMedia(link: LinkItem): Promise<CachedMedia> {
  await acquire();
  try {
    if (isInstagramUrl(link.url)) {
      const res = await fetch(`/api/instagram?url=${encodeURIComponent(link.url)}`);
      if (!res.ok) return null;
      const json = await res.json();
      const media = json.media?.[0];
      if (media?.type === "video") return { type: "video", videoUrl: media.url, thumbnail: media.thumbnail };
      if (media?.url) {
        return {
          type: "image",
          ogData: { title: null, image: media.url, description: null, siteName: "Instagram" },
        };
      }
      return null;
    }
    const res = await fetch(`/api/og?url=${encodeURIComponent(link.url)}`);
    if (!res.ok) return null;
    const ogData = (await res.json()) as OgData;
    return { type: "image", ogData };
  } catch {
    return null;
  } finally {
    release();
  }
}

export const MediaCache = {
  get(link: LinkItem): Promise<CachedMedia> {
    const existing = cache.get(link.id);
    if (existing) return existing;
    const promise = resolveMedia(link);
    cache.set(link.id, promise);
    return promise;
  },
  warm(link: LinkItem): void {
    if (!cache.has(link.id)) {
      cache.set(link.id, resolveMedia(link));
    }
  },
  _reset(): void {
    cache.clear();
    queue.length = 0;
    active = 0;
  },
};
