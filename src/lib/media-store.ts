import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { snapsave } from "snapsave-media-downloader";
import { extractMeta, extractTitleTag } from "@/lib/og";
import type { MediaAsset } from "@/generated/prisma/client";

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? path.join(process.cwd(), "data", "media");
const FETCH_TIMEOUT_MS = 30_000;

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

function extFromContentType(ct: string): string {
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  return "bin";
}

function shard(id: string): string {
  return `${id.slice(0, 2)}/${id.slice(2, 4)}`;
}

// Per-sourceUrl mutex — concurrent calls for the same URL share one in-flight resolve
const inFlight = new Map<string, Promise<MediaAsset | null>>();

export async function resolveMediaForLink(linkId: string): Promise<MediaAsset | null> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    include: { mediaAsset: true },
  });

  if (!link || link.rating !== "PENDING") return null;

  // Already resolved
  if (link.mediaAsset) {
    try {
      await fs.access(path.join(MEDIA_ROOT, link.mediaAsset.localPath));
      return link.mediaAsset;
    } catch {
      // File missing — fall through to re-resolve
    }
  }

  const existing = inFlight.get(link.url);
  if (existing) return existing;

  const promise = doResolve(linkId, link.url).finally(() => inFlight.delete(link.url));
  inFlight.set(link.url, promise);
  return promise;
}

async function doResolve(linkId: string, url: string): Promise<MediaAsset | null> {
  try {
    let mediaUrl: string;
    let thumbnailUrl: string | undefined;
    let title: string | undefined;
    let description: string | undefined;
    let isVideo = false;

    if (isInstagramUrl(url)) {
      const result = await snapsave(url);
      if (!result.success || !result.data?.media?.length) {
        await markFailed(linkId, "snapsave returned no media");
        return null;
      }
      const media = result.data.media.find((m) => m.type === "video") ?? result.data.media[0];
      if (!media?.url) {
        await markFailed(linkId, "no usable media URL");
        return null;
      }
      mediaUrl = media.url;
      thumbnailUrl = media.thumbnail ?? undefined;
      isVideo = media.type === "video";
    } else {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
        signal: AbortSignal.timeout(10_000),
      });
      const html = await res.text();
      title = extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || extractTitleTag(html) || undefined;
      description = extractMeta(html, "og:description") || extractMeta(html, "twitter:description") || undefined;
      const imageUrl = extractMeta(html, "og:image") || extractMeta(html, "twitter:image");
      if (!imageUrl) {
        await markFailed(linkId, "no og:image found");
        return null;
      }
      mediaUrl = imageUrl;
    }

    // Download the media file
    const dlRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!dlRes.ok || !dlRes.body) {
      await markFailed(linkId, `download failed: ${dlRes.status}`);
      return null;
    }

    const contentType = dlRes.headers.get("content-type") ?? (isVideo ? "video/mp4" : "image/jpeg");
    const id = generateId();
    const dir = path.join(MEDIA_ROOT, shard(id));
    const ext = extFromContentType(contentType);
    const filename = `${id}.${ext}`;
    const localPath = `${shard(id)}/${filename}`;
    const fullPath = path.join(MEDIA_ROOT, localPath);

    await fs.mkdir(dir, { recursive: true });

    const chunks: Uint8Array[] = [];
    const reader = dlRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    await fs.writeFile(fullPath, buffer);

    // Download thumbnail if video
    let thumbnailPath: string | undefined;
    if (thumbnailUrl) {
      try {
        const thumbRes = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(10_000) });
        if (thumbRes.ok && thumbRes.body) {
          const thumbFilename = `${id}_thumb.jpg`;
          const thumbLocalPath = `${shard(id)}/${thumbFilename}`;
          const thumbFullPath = path.join(MEDIA_ROOT, thumbLocalPath);
          const thumbChunks: Uint8Array[] = [];
          const thumbReader = thumbRes.body.getReader();
          while (true) {
            const { done, value } = await thumbReader.read();
            if (done) break;
            thumbChunks.push(value);
          }
          await fs.writeFile(thumbFullPath, Buffer.concat(thumbChunks.map((c) => Buffer.from(c))));
          thumbnailPath = thumbLocalPath;
        }
      } catch {
        // thumbnail is best-effort
      }
    }

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: {
          id,
          sourceUrl: url,
          type: isVideo ? "VIDEO" : "IMAGE",
          localPath,
          contentType,
          sizeBytes: buffer.byteLength,
          thumbnailPath,
          title,
          description,
        },
      });
      await tx.link.update({
        where: { id: linkId },
        data: { mediaAssetId: id, mediaStatus: "RESOLVED" },
      });
      return created;
    });

    console.log(`[media-store] resolved sourceUrl=${url} type=${asset.type} size=${asset.sizeBytes} id=${id}`);
    return asset;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[media-store] failed sourceUrl=${url} reason=${reason}`);
    await markFailed(linkId, reason);
    return null;
  }
}

async function markFailed(linkId: string, reason: string) {
  await prisma.link.update({
    where: { id: linkId },
    data: { mediaStatus: "FAILED", mediaError: reason.slice(0, 500) },
  }).catch(() => {});
}

export async function evictMediaForLink(linkId: string): Promise<void> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    include: { mediaAsset: true },
  });
  if (!link?.mediaAsset) return;

  const asset = link.mediaAsset;

  // Best-effort file deletion
  await Promise.allSettled([
    fs.unlink(path.join(MEDIA_ROOT, asset.localPath)),
    asset.thumbnailPath ? fs.unlink(path.join(MEDIA_ROOT, asset.thumbnailPath)) : Promise.resolve(),
  ]);

  await prisma.$transaction([
    prisma.link.update({
      where: { id: linkId },
      data: { mediaAssetId: null, mediaStatus: "EVICTED" },
    }),
    prisma.mediaAsset.delete({ where: { id: asset.id } }),
  ]);
}

// Simple cuid-like ID without external dep
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `c${timestamp}${random}`;
}
