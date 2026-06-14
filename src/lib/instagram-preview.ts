import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { getInstagramPostId, instagramThumbnailUrl } from "@/lib/instagram";
import { instagramPreviewFilename } from "@/lib/instagram-preview-name";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";
const FETCH_TIMEOUT_MS = 15_000;

// Per-postId mutex so concurrent requests for the same preview share one fetch.
const inFlight = new Map<string, Promise<string | null>>();

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function pickPreviewSource(url: string, postId: string): Promise<string | null> {
  // 1) snapsave — the same downloader the main resolver uses. Prefer an image
  //    item; otherwise use a video item's thumbnail.
  try {
    const { snapsave } = await import("snapsave-media-downloader");
    const result = await snapsave(url);
    const media = result?.success ? result.data?.media ?? [] : [];
    const imageItem = media.find((m) => m.type !== "video" && m.url);
    if (imageItem?.url) return imageItem.url;
    const videoItem = media.find((m) => m.type === "video") ?? media[0];
    if (videoItem?.thumbnail) return videoItem.thumbnail;
    if (videoItem?.url) return videoItem.url;
  } catch {
    // fall through to the stable endpoint
  }
  // 2) Stable, postId-based endpoint (302s to the CDN; fine server-side).
  return instagramThumbnailUrl(postId);
}

async function buildPreview(url: string, postId: string, filename: string): Promise<string | null> {
  const finalPath = path.join(MEDIA_DIR, filename);
  if (await fileExists(finalPath)) return finalPath;

  const src = await pickPreviewSource(url, postId);
  if (!src) return null;

  let res: Response;
  try {
    res = await fetch(src, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let compressed: Buffer;
  try {
    const raw = Buffer.from(await res.arrayBuffer());
    compressed = await sharp(raw)
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  // Atomic publish: write to a temp file then rename so readers never see a partial JPEG.
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, compressed);
  await fs.rename(tmpPath, finalPath);
  return finalPath;
}

/**
 * Ensure a local cached preview JPEG exists for an Instagram URL.
 * Returns the absolute file path, or null if no image could be obtained.
 */
export function ensureInstagramPreview(url: string): Promise<string | null> {
  const postId = getInstagramPostId(url);
  if (!postId) return Promise.resolve(null);
  const filename = instagramPreviewFilename(postId);
  if (!filename) return Promise.resolve(null);

  const existing = inFlight.get(postId);
  if (existing) return existing;

  const promise = buildPreview(url, postId, filename).finally(() => inFlight.delete(postId));
  inFlight.set(postId, promise);
  return promise;
}
