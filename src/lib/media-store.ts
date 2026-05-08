import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { extractMeta, extractTitleTag } from "@/lib/og";
import type { MediaAsset } from "@/generated/prisma/client";

const FETCH_TIMEOUT_MS = 30_000;
const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

async function ensureMediaDir(): Promise<void> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

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

async function localPut(
  pathname: string,
  body: Buffer | ReadableStream<Uint8Array>,
): Promise<{ url: string }> {
  await ensureMediaDir();
  const filename = path.basename(pathname);
  const filePath = path.join(MEDIA_DIR, filename);

  if (body instanceof Buffer) {
    await fs.writeFile(filePath, body);
  } else {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Buffer[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    await fs.writeFile(filePath, Buffer.concat(chunks));
  }

  return { url: `/media/${filename}` };
}

async function localDel(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const filename = path.basename(url);
        await fs.unlink(path.join(MEDIA_DIR, filename));
      } catch {
        // best-effort
      }
    }),
  );
}

// Per-sourceUrl mutex — concurrent calls for the same URL share one in-flight resolve
const inFlight = new Map<string, Promise<MediaAsset | null>>();

export async function resolveMediaForLink(linkId: string, { force = false } = {}): Promise<MediaAsset | null> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    include: { mediaAsset: true },
  });

  if (!link) return null;
  if (!force && link.rating !== "PENDING") return null;

  // Already resolved and URL still set
  if (link.mediaAsset?.blobUrl) return link.mediaAsset;

  const existing = inFlight.get(link.url);
  if (existing) return existing;

  const promise = doResolve(linkId, link.url).finally(() => inFlight.delete(link.url));
  inFlight.set(link.url, promise);
  return promise;
}

async function doResolve(linkId: string, url: string): Promise<MediaAsset | null> {
  try {
    let mediaUrl: string;
    let thumbnailSourceUrl: string | undefined;
    let title: string | undefined;
    let description: string | undefined;
    let isVideo = false;

    if (isInstagramUrl(url)) {
      const { snapsave } = await import("snapsave-media-downloader");
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
      thumbnailSourceUrl = media.thumbnail ?? undefined;
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

    // Download media
    const dlRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!dlRes.ok || !dlRes.body) {
      await markFailed(linkId, `download failed: ${dlRes.status}`);
      return null;
    }

    const rawContentType = dlRes.headers.get("content-type") ?? (isVideo ? "video/mp4" : "image/jpeg");
    const id = generateId();

    let uploadBody: Buffer | ReadableStream<Uint8Array>;
    let contentType: string;
    let ext: string;

    if (!isVideo) {
      const raw = Buffer.from(await dlRes.arrayBuffer());
      const compressed = await sharp(raw)
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      uploadBody = compressed;
      contentType = "image/jpeg";
      ext = "jpg";
    } else {
      uploadBody = dlRes.body!;
      contentType = rawContentType;
      ext = extFromContentType(rawContentType);
    }

    const pathname = `media/${id}.${ext}`;
    const { url: blobUrl } = await localPut(pathname, uploadBody);

    // Upload thumbnail best-effort
    let thumbnailUrl: string | undefined;
    if (thumbnailSourceUrl) {
      try {
        const thumbRes = await fetch(thumbnailSourceUrl, { signal: AbortSignal.timeout(10_000) });
        if (thumbRes.ok && thumbRes.body) {
          const thumbRaw = Buffer.from(await thumbRes.arrayBuffer());
          const thumbCompressed = await sharp(thumbRaw)
            .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer();
          const { url: tUrl } = await localPut(`media/${id}_thumb.jpg`, thumbCompressed);
          thumbnailUrl = tUrl;
        }
      } catch {
        // thumbnail is best-effort
      }
    }

    const sizeBytes = uploadBody instanceof Buffer
      ? uploadBody.byteLength
      : parseInt(dlRes.headers.get("content-length") ?? "0", 10);

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: {
          id,
          sourceUrl: url,
          type: isVideo ? "VIDEO" : "IMAGE",
          blobUrl,
          contentType,
          sizeBytes,
          thumbnailUrl,
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

    console.log(`[media-store] resolved sourceUrl=${url} type=${asset.type} size=${sizeBytes} id=${id}`);
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

export async function resetStaleBlobAssets(): Promise<number> {
  const assets = await prisma.mediaAsset.findMany({
    select: { id: true, blobUrl: true },
  });

  const staleIds: string[] = [];
  for (const asset of assets) {
    if (!asset.blobUrl.startsWith("/media/")) {
      // Old Vercel blob URL or invalid — mark stale
      staleIds.push(asset.id);
      continue;
    }
    const filename = path.basename(asset.blobUrl);
    try {
      await fs.access(path.join(MEDIA_DIR, filename));
    } catch {
      staleIds.push(asset.id);
    }
  }

  if (staleIds.length === 0) return 0;

  await prisma.$transaction([
    prisma.link.updateMany({
      where: { mediaAssetId: { in: staleIds } },
      data: { mediaAssetId: null, mediaStatus: "PENDING", mediaError: null },
    }),
    prisma.mediaAsset.deleteMany({ where: { id: { in: staleIds } } }),
  ]);

  return staleIds.length;
}

export async function evictMediaForLink(linkId: string): Promise<void> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    include: { mediaAsset: true },
  });
  if (!link?.mediaAsset) return;

  const asset = link.mediaAsset;
  const urlsToDelete = [asset.blobUrl, asset.thumbnailUrl].filter(Boolean) as string[];

  if (urlsToDelete.length > 0) {
    await localDel(urlsToDelete);
  }

  await prisma.$transaction([
    prisma.link.update({
      where: { id: linkId },
      data: { mediaAssetId: null, mediaStatus: "EVICTED" },
    }),
    prisma.mediaAsset.delete({ where: { id: asset.id } }),
  ]);
}

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `c${timestamp}${random}`;
}
