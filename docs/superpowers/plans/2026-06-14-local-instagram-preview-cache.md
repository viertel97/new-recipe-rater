# Local Instagram Preview Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop hot-linking Instagram CDN preview images (which the browser blocks via `Cross-Origin-Resource-Policy: NotSameOrigin`) by fetching each preview server-side, storing it under `MEDIA_DIR`, and serving it same-origin.

**Architecture:** A new `GET /api/ig-thumb?url=<instagram url>` route does get-or-create: if `ig_<postId>.jpg` already exists in `MEDIA_DIR`, stream it; otherwise fetch the image server-side (reusing the proven `snapsave` path, with `instagram.com/p/<id>/media/?size=l` as a fallback), compress with `sharp`, write it to disk, then stream it. The card's unresolved-Instagram fallback points its `<img src>` at this route instead of the CDN. No DB/schema change — the cached files are regenerable, served by the existing `/media/[...path]` route too.

**Tech Stack:** Next.js 16 App Router route handlers, `snapsave-media-downloader`, `sharp`, Node `fs/promises`, Vitest.

---

## Context for the implementer

- **Broken toolchain:** `npm`/`pnpm install` are forbidden (npm segfaults on this Node). `node_modules`, `.env`, and `src/generated` are **symlinks** into the main repo and already exist. Run tools via local binaries only:
  - tsc: `./node_modules/.bin/tsc --noEmit`
  - eslint: `./node_modules/.bin/eslint <file>`
  - tests: `./node_modules/.bin/vitest run`
- **Commit style:** conventional commits, and **NO `Co-Authored-By` / no AI attribution line** (hard requirement). Never run `git config`, never use `--no-verify`. Stage only the specific files named in each task.
- **Reference code already in the repo** (read these to match conventions):
  - `src/lib/media-store.ts` — `doResolve` shows the exact `snapsave` shape (`const { snapsave } = await import("snapsave-media-downloader"); const result = await snapsave(url);` → `result.success`, `result.data.media[]` items `{ url, thumbnail, type }`), the `sharp(...).resize(...).jpeg(...).toBuffer()` compression, and `MEDIA_DIR` default `/data/media` with `fs.mkdir(MEDIA_DIR, { recursive: true })`.
  - `src/app/media/[...path]/route.ts` — the file-streaming + cache-header style to mirror.
  - `src/lib/instagram.ts` — `getInstagramPostId(url)`, `isInstagramUrl(url)`, `instagramThumbnailUrl(postId)` (returns `https://www.instagram.com/p/<id>/media/?size=l`).
  - `src/components/link-card.tsx` lines 441-479 — the unresolved-Instagram fallback that currently hot-links `instagramThumbnailUrl(postId)` at line ~458.

---

## Task 1: Pure preview-filename helper (TDD)

**Files:**
- Create: `src/lib/__tests__/instagram-preview-name.test.ts`
- Create: `src/lib/instagram-preview-name.ts`

A tiny pure helper so the cache filename and its safety guard are unit-tested and reusable by the route without importing the server-only IO module.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/instagram-preview-name.test.ts
import { describe, it, expect } from "vitest";
import { instagramPreviewFilename } from "@/lib/instagram-preview-name";

describe("instagramPreviewFilename", () => {
  it("builds a jpg filename from a valid post id", () => {
    expect(instagramPreviewFilename("DKabc-9xYz_")).toBe("ig_DKabc-9xYz_.jpg");
  });

  it("returns null for ids with path-traversal or unexpected characters", () => {
    expect(instagramPreviewFilename("../etc/passwd")).toBeNull();
    expect(instagramPreviewFilename("a/b")).toBeNull();
    expect(instagramPreviewFilename("a.b")).toBeNull();
    expect(instagramPreviewFilename("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/lib/__tests__/instagram-preview-name.test.ts`
Expected: FAIL (`Cannot find module '@/lib/instagram-preview-name'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/instagram-preview-name.ts
// Instagram post ids are [A-Za-z0-9_-]; reject anything else so the value is
// safe to use directly as a filename (no path traversal).
const POST_ID_RE = /^[\w-]+$/;

export function instagramPreviewFilename(postId: string): string | null {
  if (!POST_ID_RE.test(postId)) return null;
  return `ig_${postId}.jpg`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/lib/__tests__/instagram-preview-name.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite + lint**

Run: `./node_modules/.bin/vitest run` (expect all prior tests still pass + the 2 new) and `./node_modules/.bin/eslint src/lib/instagram-preview-name.ts src/lib/__tests__/instagram-preview-name.test.ts` (expect exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/lib/instagram-preview-name.ts src/lib/__tests__/instagram-preview-name.test.ts
git commit -m "feat(media): pure helper for instagram preview cache filename"
```

---

## Task 2: Server module that fetches + caches the preview to disk

**Files:**
- Create: `src/lib/instagram-preview.ts`

Server-only module (imported only by the route). Exposes `ensureInstagramPreview(url): Promise<string | null>` returning the absolute path of the cached JPEG, or `null` if no image could be obtained. Reuses the proven `snapsave` path and falls back to the stable `instagram.com/p/<id>/media/?size=l` URL. De-dupes concurrent calls for the same post id with an in-flight map. Writes atomically (temp file + rename) so concurrent reads never see a partial file.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/instagram-preview.ts
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
```

- [ ] **Step 2: Typecheck + lint**

Run: `./node_modules/.bin/tsc --noEmit` (expect exit 0) and `./node_modules/.bin/eslint src/lib/instagram-preview.ts` (expect exit 0).

If `result.data?.media` typing from `snapsave` causes a tsc error, mirror exactly how `src/lib/media-store.ts` accesses `result.data.media` (it indexes the same shape without extra typing). Do not add `any`; use the same access pattern as the reference file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/instagram-preview.ts
git commit -m "feat(media): fetch and cache instagram previews to local media dir"
```

---

## Task 3: The `/api/ig-thumb` route

**Files:**
- Create: `src/app/api/ig-thumb/route.ts`

Streams the cached preview same-origin. Mirrors the streaming + header style of `src/app/media/[...path]/route.ts`.

- [ ] **Step 1: Write the implementation**

```ts
// src/app/api/ig-thumb/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { isInstagramUrl } from "@/lib/instagram";
import { ensureInstagramPreview } from "@/lib/instagram-preview";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !isInstagramUrl(url)) {
    return new NextResponse(null, { status: 400 });
  }

  const filePath = await ensureInstagramPreview(url);
  if (!filePath) {
    return new NextResponse(null, { status: 404 });
  }

  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(chunk));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `./node_modules/.bin/tsc --noEmit` (exit 0) and `./node_modules/.bin/eslint src/app/api/ig-thumb/route.ts` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ig-thumb/route.ts
git commit -m "feat(media): add same-origin instagram preview route"
```

---

## Task 4: Point the card fallback at the route

**Files:**
- Modify: `src/components/link-card.tsx`

In the unresolved-Instagram branch (`isInsta && postId`, around lines 441-479), the `<img>` currently uses `src={instagramThumbnailUrl(postId)}`. Swap it for the same-origin route. After the change, `instagramThumbnailUrl` is no longer used in this file — remove it from the import on line 7. Leave everything else (the `onError` hide handler, `referrerPolicy`, the click-to-open-modal behavior, the resolved-`mediaAsset` branch, `OgPreview`) unchanged.

- [ ] **Step 1: Update the import (line 7)**

Old:
```ts
import { getInstagramPostId, isInstagramUrl, instagramThumbnailUrl } from "@/lib/instagram";
```
New:
```ts
import { getInstagramPostId, isInstagramUrl } from "@/lib/instagram";
```

- [ ] **Step 2: Update the `<img src>` (around line 458)**

Old:
```tsx
            <img
              src={instagramThumbnailUrl(postId)}
```
New:
```tsx
            <img
              src={`/api/ig-thumb?url=${encodeURIComponent(link.url)}`}
```

(Leave the remaining `<img>` attributes — `alt`, `loading`, `decoding`, `referrerPolicy`, `className`, `onError` — exactly as they are.)

- [ ] **Step 3: Typecheck + lint**

Run: `./node_modules/.bin/tsc --noEmit` (exit 0) and `./node_modules/.bin/eslint src/components/link-card.tsx` (exit 0 — `instagramThumbnailUrl` must no longer appear, so no unused-import error). `getInstagramPostId` and `isInstagramUrl` are still used, so they stay.

- [ ] **Step 4: Commit**

```bash
git add src/components/link-card.tsx
git commit -m "fix(link-card): serve instagram previews from same-origin cache"
```

---

## Task 5: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full static gates**

Run:
- `./node_modules/.bin/tsc --noEmit` → exit 0
- `./node_modules/.bin/eslint src/lib/instagram-preview-name.ts src/lib/instagram-preview.ts src/app/api/ig-thumb/route.ts src/components/link-card.tsx` → exit 0 (no new warnings)
- `./node_modules/.bin/vitest run` → all tests pass (the prior 37 + 2 new = 39)

- [ ] **Step 2: Confirm no remaining hot-link**

Run: `grep -rn "instagramThumbnailUrl" src/components` → expect **no** matches (the card no longer hot-links). `grep -rn "instagramThumbnailUrl" src/lib` may still match `instagram.ts` (definition) and `instagram-preview.ts` (server-side fallback use) — those are expected.

- [ ] **Step 3: Manual smoke note**

A live browser/dev-server test is not reliably reproducible in this sandbox (`next build` is blocked by a Google Fonts fetch failure in `src/app/layout.tsx`, and login is required). Record this limitation in the final report. If a dev server *is* runnable, verify: an unresolved Instagram card requests `/api/ig-thumb?url=…`, the response is `200 image/jpeg` from same-origin (no `NotSameOrigin` console error), a second load is served from the on-disk cache, and a non-Instagram/garbage `url` returns `400`.
