# Memory Leak Fix + Shareable Temporary Collections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the dashboard memory leak (live Instagram iframes), bound list/media cost, and add a logged-in-only "select recipes → 24h shareable link" feature.

**Architecture:** Phase 1 removes per-card Instagram `<iframe>`s (the leak), lazy-loads images, applies `content-visibility` windowing, and routes OG fetches through the existing capped `MediaCache` (now LRU-bounded). Phase 2 adds a `SharedCollection` Prisma model storing a snapshot of link IDs with a 24h `expiresAt`; the home page reads a `?c=<token>` param and renders the dashboard scoped to those recipes in "collection mode".

**Tech Stack:** Next.js 16 (App Router, server components + server actions), React 19, Prisma 7 (postgres adapter, Neon), next-auth v5, zod v4, Vitest + Testing Library, Tailwind v4.

---

## File Structure

**Phase 1**
- Modify `src/components/link-card.tsx` — replace Instagram iframe with a static thumbnail; lazy-load all imgs; route `OgPreview` through `MediaCache`.
- Modify `src/components/dashboard.tsx` — `content-visibility` card wrappers.
- Modify `src/lib/media-cache.ts` — LRU bound on the cache Map.
- Modify `src/lib/media-cache.ts` test — `src/lib/__tests__/media-cache.test.ts`.
- Create `src/lib/instagram.ts` — pure `instagramThumbnailUrl(postId)` + `getInstagramPostId(url)` helpers (extracted so the card has no regex inline and they are unit-testable).
- Create `src/lib/__tests__/instagram.test.ts`.
- Modify `src/app/page.tsx` — trim selected columns.

**Phase 2**
- Modify `prisma/schema.prisma` — add `SharedCollection` model + `User` back-relation.
- Create migration `prisma/migrations/<ts>_add_shared_collection/`.
- Create `src/lib/collections.ts` — pure helpers (`isExpired`, `hoursUntil`) + `createCollectionSchema`.
- Create `src/lib/__tests__/collections.test.ts`.
- Modify `src/lib/actions.ts` — `createSharedCollection` server action + `getSharedCollection` resolver (with opportunistic cleanup).
- Modify `src/app/page.tsx` — read `searchParams.c`, resolve collection, pass `collection` prop to `Dashboard`.
- Modify `src/components/dashboard.tsx` — select mode (checkboxes + create-link bar) and collection mode (banner + hidden filter bar).
- Modify `src/types/link.ts` — add `SharedCollectionView` type.

---

## Phase 1 — Memory leak + loading

### Task 1: Extract Instagram URL helpers (TDD)

**Files:**
- Create: `src/lib/instagram.ts`
- Test: `src/lib/__tests__/instagram.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/instagram.test.ts
import { describe, it, expect } from "vitest";
import { getInstagramPostId, isInstagramUrl, instagramThumbnailUrl } from "@/lib/instagram";

describe("instagram helpers", () => {
  it("extracts post id from reel/p/tv urls", () => {
    expect(getInstagramPostId("https://instagram.com/p/AbC-1/")).toBe("AbC-1");
    expect(getInstagramPostId("https://www.instagram.com/reel/XyZ_2/?x=1")).toBe("XyZ_2");
    expect(getInstagramPostId("https://example.com/p/nope/")).toBeNull();
  });

  it("detects instagram post urls", () => {
    expect(isInstagramUrl("https://instagram.com/reel/AbC/")).toBe(true);
    expect(isInstagramUrl("https://example.com/recipe")).toBe(false);
  });

  it("builds a lightweight thumbnail url (no iframe)", () => {
    expect(instagramThumbnailUrl("AbC-1")).toBe(
      "https://www.instagram.com/p/AbC-1/media/?size=l"
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/instagram.test.ts`
Expected: FAIL — cannot find module `@/lib/instagram`.

- [ ] **Step 3: Implement**

```ts
// src/lib/instagram.ts
const POST_ID_RE = /instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/;

export function getInstagramPostId(url: string): string | null {
  const m = url.match(POST_ID_RE);
  return m ? m[1] : null;
}

export function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

export function instagramThumbnailUrl(postId: string): string {
  return `https://www.instagram.com/p/${postId}/media/?size=l`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/__tests__/instagram.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram.ts src/lib/__tests__/instagram.test.ts
git commit -m "feat(instagram): extract url helpers with lightweight thumbnail"
```

---

### Task 2: Replace Instagram iframe with static thumbnail (the leak fix)

**Files:**
- Modify: `src/components/link-card.tsx:8-15` (inline helpers) and `:435-470` (iframe branch)

- [ ] **Step 1: Replace the inline helpers with the shared module**

In `src/components/link-card.tsx`, delete the local `getPostId` and `isInstagramUrl` functions (lines 8-15) and import from the new module instead. Update the import block near the top:

```tsx
import { getInstagramPostId, isInstagramUrl, instagramThumbnailUrl } from "@/lib/instagram";
```

Then update the call sites inside `LinkCard` (currently `getPostId(link.url)`):

```tsx
  const isInsta = isInstagramUrl(link.url);
  const postId = isInsta ? getInstagramPostId(link.url) : null;
```

- [ ] **Step 2: Replace the iframe branch with a static thumbnail**

Replace the entire `isInsta && postId ? ( ... )` block (the `<iframe ...>` preview, ~lines 435-467) with a static image that opens the existing modal/new-tab on click. The `InstagramModal`, desktop check, and `modalOpen` state stay exactly as they are:

```tsx
      ) : isInsta && postId ? (
        <>
          <div
            className="relative aspect-square max-h-[220px] sm:max-h-[360px] overflow-hidden bg-background/30 cursor-pointer group"
            onClick={() => {
              const isDesktop =
                typeof window !== "undefined" &&
                window.matchMedia("(hover: hover) and (pointer: fine)").matches;
              if (!isDesktop) {
                window.open(link.url, "_blank");
              } else {
                setModalOpen(true);
              }
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={instagramThumbnailUrl(postId)}
              alt={link.notes ?? "Instagram recipe"}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
              <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 opacity-70 group-hover:opacity-100 transition-opacity">
                <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>
          {modalOpen && <InstagramModal url={link.url} onClose={closeModal} />}
        </>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (the core success criterion)**

Run: `npm run dev`, open the dashboard logged in. In DevTools → Elements, search the DOM for `<iframe` — expect **zero** iframes in the recipe list. Open DevTools → Memory / Performance Monitor, scroll the entire list top-to-bottom; "JS heap size" and "DOM Nodes" should plateau, not climb without bound. Click an Instagram card on desktop → the `InstagramModal` still opens and plays the video/image. On mobile width, clicking opens a new tab. Report the before/after heap numbers in the task summary.

- [ ] **Step 5: Commit**

```bash
git add src/components/link-card.tsx
git commit -m "fix(dashboard): replace live instagram iframes with static thumbnails"
```

---

### Task 3: Lazy-load remaining images + content-visibility windowing

**Files:**
- Modify: `src/components/link-card.tsx` (`MediaPreview` img ~line 27, `OgPreview` imgs ~line 81/104, favicon img)
- Modify: `src/components/dashboard.tsx:350-360` (card wrapper)

- [ ] **Step 1: Add lazy/async decoding to every card `<img>`**

In `link-card.tsx`, add `loading="lazy"` and `decoding="async"` to each `<img>` that does not already have them: the `MediaPreview` image, both `OgPreview` images (the OG `og.image` and the favicon fallback). Example for `MediaPreview`:

```tsx
      <img
        src={imgSrc}
        alt={asset.title || ""}
        loading="lazy"
        decoding="async"
        className="w-full object-cover max-h-[220px] sm:max-h-[300px] group-hover:scale-[1.02] transition-transform duration-300"
      />
```

- [ ] **Step 2: Apply content-visibility to the dashboard card wrapper**

In `dashboard.tsx`, the grid maps `filtered` into `<div className="animate-card-enter" style={{ animationDelay: ... }}>`. Add `content-visibility: auto` and an intrinsic size so the browser skips offscreen layout/paint while keeping scroll height stable:

```tsx
          {filtered.map((link, i) => (
            <div
              key={link.id}
              className="animate-card-enter"
              style={{
                animationDelay: `${Math.min(i, 12) * 60}ms`,
                contentVisibility: "auto",
                containIntrinsicSize: "auto 420px",
              }}
            >
              <LinkCard link={link} canReview={true} tandoorUrl={tandoorUrl} />
            </div>
          ))}
```

Note: the `animationDelay` is capped at index 12 so a list of hundreds doesn't schedule multi-second staggered animations.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. Scroll the dashboard fast; cards below the fold should not fetch their images until near the viewport (watch DevTools → Network filtered to Img — requests trickle in on scroll, not all at once). Layout must not jump (intrinsic size keeps placeholders sized). Report whether image requests are now lazy.

- [ ] **Step 5: Commit**

```bash
git add src/components/link-card.tsx src/components/dashboard.tsx
git commit -m "perf(dashboard): lazy-load images and skip offscreen card paint"
```

---

### Task 4: Bound the MediaCache map (LRU) and route OG fetches through it

**Files:**
- Modify: `src/lib/media-cache.ts`
- Modify: `src/lib/__tests__/media-cache.test.ts`
- Modify: `src/components/link-card.tsx` (`OgPreview`)

- [ ] **Step 1: Write the failing LRU test**

Append to `src/lib/__tests__/media-cache.test.ts`:

```ts
  it("evicts least-recently-used entries past the cap", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "x", image: null, description: null, siteName: null }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    // Cap is 200; insert 201 distinct links, then re-request the first one.
    const links = Array.from({ length: 201 }, (_, i) => makeLink(`K${i}`, `https://example.com/${i}`));
    for (const l of links) await MediaCache.get(l);

    // K0 should have been evicted -> a re-get refetches it.
    const before = fetchSpy.mock.calls.length;
    await MediaCache.get(links[0]);
    expect(fetchSpy.mock.calls.length).toBe(before + 1);
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/media-cache.test.ts -t "evicts"`
Expected: FAIL — K0 is still cached, no refetch.

- [ ] **Step 3: Implement the LRU cap**

In `src/lib/media-cache.ts`, add a cap and re-insert on access so the Map's insertion order acts as LRU. Replace the `cache` declaration and the `MediaCache.get`/`warm` methods:

```ts
const MAX_CONCURRENT = 2;
const MAX_CACHE = 200;

const cache = new Map<string, Promise<CachedMedia>>();

function touch(id: string, value: Promise<CachedMedia>): void {
  cache.delete(id);
  cache.set(id, value);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
```

```ts
export const MediaCache = {
  get(link: LinkItem): Promise<CachedMedia> {
    const existing = cache.get(link.id);
    if (existing) {
      touch(link.id, existing);
      return existing;
    }
    const promise = resolveMedia(link);
    touch(link.id, promise);
    return promise;
  },
  warm(link: LinkItem): void {
    if (!cache.has(link.id)) {
      touch(link.id, resolveMedia(link));
    }
  },
  _reset(): void {
    cache.clear();
    queue.length = 0;
    active = 0;
  },
};
```

- [ ] **Step 4: Run the full media-cache suite, verify pass**

Run: `npx vitest run src/lib/__tests__/media-cache.test.ts`
Expected: PASS (all prior tests + the new eviction test). The "limits in-flight to 2" test must still pass.

- [ ] **Step 5: Route OgPreview through MediaCache**

In `link-card.tsx`, `OgPreview` currently calls `fetch('/api/og?...')` directly on mount. Replace its effect to use the capped cache so the dashboard never fires hundreds of parallel fetches:

```tsx
import { MediaCache } from "@/lib/media-cache";
```

```tsx
function OgPreview({ url }: { url: string }) {
  const [og, setOg] = useState<OgData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const link = { id: `og:${url}`, url } as unknown as LinkItem;
    MediaCache.get(link)
      .then((m) => {
        if (cancelled) return;
        setOg(m && m.type === "image" ? m.ogData : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  // ...rest of OgPreview unchanged
```

Note: `MediaCache.get` already routes non-Instagram URLs to `/api/og` and returns `{ type: "image", ogData }`, so behavior is identical but concurrency-limited and cached.

- [ ] **Step 6: Typecheck + manual check**

Run: `npx tsc --noEmit` (expect no errors), then `npm run dev` and confirm OG previews still render on non-Instagram cards and Network shows at most ~2 `/api/og` requests in flight at once.

- [ ] **Step 7: Commit**

```bash
git add src/lib/media-cache.ts src/lib/__tests__/media-cache.test.ts src/components/link-card.tsx
git commit -m "perf(media): LRU-bound media cache and cap og fetch concurrency"
```

---

### Task 5: Trim the home-page query payload

**Files:**
- Modify: `src/app/page.tsx:12-18`

- [ ] **Step 1: Restrict selected columns**

The card uses: `id, url, rating, urgency, notes, reviewNote, tandoorRecipeId, category, createdAt, submittedBy{name,email}, mediaAsset`. Replace `include` with an explicit `select` to drop unused columns (`categoryError`, `categoryAttempts`, `mediaError`, `mediaAssetId`, `submittedById` not needed by the card — but `LinkItem` requires `submittedById`, `categoryStatus`, `mediaStatus`, so keep those):

```tsx
  const links = await prisma.link.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      rating: true,
      urgency: true,
      notes: true,
      reviewNote: true,
      tandoorRecipeId: true,
      category: true,
      categoryStatus: true,
      createdAt: true,
      submittedById: true,
      mediaStatus: true,
      submittedBy: { select: { name: true, email: true } },
      mediaAsset: true,
    },
  });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (shape matches `LinkItem`). If TS complains about a missing field, add it to the `select`.

- [ ] **Step 3: Manual check + commit**

Run `npm run dev`, confirm the dashboard renders unchanged. Then:

```bash
git add src/app/page.tsx
git commit -m "perf(home): select only the columns the card renders"
```

---

## Phase 2 — Shareable temporary collections

### Task 6: Add the SharedCollection model + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model and back-relation**

In `prisma/schema.prisma`, add to `User` (inside the model, alongside `links Link[]`):

```prisma
  sharedCollections SharedCollection[]
```

Then add the new model after the `Link` model:

```prisma
model SharedCollection {
  id          String   @id @default(cuid())
  linkIds     String[]
  createdBy   User     @relation(fields: [createdById], references: [id])
  createdById String
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@index([expiresAt])
}
```

- [ ] **Step 2: Create + apply the migration and regenerate the client**

Run: `npm run db:migrate -- --name add_shared_collection`
Expected: a new folder `prisma/migrations/<timestamp>_add_shared_collection/migration.sql` is created and applied; `prisma generate` runs (postinstall/`db:migrate` regenerates `src/generated/prisma`). Confirm `SharedCollection` now exists in `src/generated/prisma`.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add SharedCollection model for temporary share links"
```

---

### Task 7: Collection helpers + validation (TDD)

**Files:**
- Create: `src/lib/collections.ts`
- Test: `src/lib/__tests__/collections.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/collections.test.ts
import { describe, it, expect } from "vitest";
import { isExpired, hoursUntil, createCollectionSchema, COLLECTION_TTL_MS } from "@/lib/collections";

describe("collections helpers", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("TTL is 24 hours", () => {
    expect(COLLECTION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("detects expiry", () => {
    expect(isExpired(new Date("2026-06-12T11:59:59Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-06-12T12:00:01Z"), now)).toBe(false);
  });

  it("rounds hours remaining up, floored at 0", () => {
    expect(hoursUntil(new Date("2026-06-12T13:30:00Z"), now)).toBe(2);
    expect(hoursUntil(new Date("2026-06-12T11:00:00Z"), now)).toBe(0);
  });

  it("validates a non-empty, capped id list", () => {
    expect(createCollectionSchema.safeParse({ linkIds: [] }).success).toBe(false);
    expect(createCollectionSchema.safeParse({ linkIds: ["a", "b"] }).success).toBe(true);
    const tooMany = { linkIds: Array.from({ length: 201 }, (_, i) => `id${i}`) };
    expect(createCollectionSchema.safeParse(tooMany).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/collections.test.ts`
Expected: FAIL — cannot find module `@/lib/collections`.

- [ ] **Step 3: Implement**

```ts
// src/lib/collections.ts
import { z } from "zod";

export const COLLECTION_TTL_MS = 24 * 60 * 60 * 1000;

export const createCollectionSchema = z.object({
  linkIds: z.array(z.string().min(1)).min(1).max(200),
});

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function hoursUntil(expiresAt: Date, now: Date = new Date()): number {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (60 * 60 * 1000));
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/__tests__/collections.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts src/lib/__tests__/collections.test.ts
git commit -m "feat(collections): expiry helpers and create-collection schema"
```

---

### Task 8: Server action to create + resolver to read collections

**Files:**
- Modify: `src/lib/actions.ts`
- Modify: `src/types/link.ts`

- [ ] **Step 1: Add the view type**

Append to `src/types/link.ts`:

```ts
export type SharedCollectionView = {
  token: string;
  linkIds: string[];
  expiresAt: Date;
  hoursLeft: number;
};
```

- [ ] **Step 2: Add `createSharedCollection` server action**

In `src/lib/actions.ts`, add imports near the top:

```ts
import { createCollectionSchema, COLLECTION_TTL_MS, isExpired, hoursUntil } from "@/lib/collections";
import type { SharedCollectionView } from "@/types/link";
```

Append this action (returns the token; the form builds the URL):

```ts
export async function createSharedCollection(
  linkIds: string[]
): Promise<{ token: string } | { error: string }> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const parsed = createCollectionSchema.safeParse({ linkIds });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Only keep ids that actually exist, preserving uniqueness.
  const existing = await prisma.link.findMany({
    where: { id: { in: parsed.data.linkIds } },
    select: { id: true },
  });
  const validIds = existing.map((l) => l.id);
  if (validIds.length === 0) return { error: "No valid recipes selected" };

  const collection = await prisma.sharedCollection.create({
    data: {
      linkIds: validIds,
      createdById: session.user.id,
      expiresAt: new Date(Date.now() + COLLECTION_TTL_MS),
    },
  });

  return { token: collection.id };
}
```

- [ ] **Step 3: Add `getSharedCollection` resolver with opportunistic cleanup**

Append to `src/lib/actions.ts`:

```ts
export async function getSharedCollection(
  token: string
): Promise<SharedCollectionView | null> {
  if (!token) return null;

  const collection = await prisma.sharedCollection.findUnique({
    where: { id: token },
  });

  const now = new Date();

  if (!collection || isExpired(collection.expiresAt, now)) {
    // Best-effort cleanup of this and any other expired rows; never throw.
    prisma.sharedCollection
      .deleteMany({ where: { expiresAt: { lte: now } } })
      .catch((err) => console.error("[collections] cleanup failed:", err));
    return null;
  }

  return {
    token: collection.id,
    linkIds: collection.linkIds,
    expiresAt: collection.expiresAt,
    hoursLeft: hoursUntil(collection.expiresAt, now),
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`prisma.sharedCollection` exists after Task 6's `prisma generate`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions.ts src/types/link.ts
git commit -m "feat(collections): create action and expiring resolver"
```

---

### Task 9: Home page reads the share token

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Read `searchParams.c`, resolve, and scope the query**

In Next.js 16 App Router, `searchParams` is a Promise. Update `Home` to accept it, resolve the collection, and restrict the link query when a valid token is present:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Header } from "@/components/header";
import { Dashboard } from "@/components/dashboard";
import { SubmitLinkForm } from "@/components/submit-link-form";
import { getSharedCollection } from "@/lib/actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { c: token } = await searchParams;
  const collection = token ? await getSharedCollection(token) : null;
  const expiredToken = Boolean(token) && collection === null;

  const links = await prisma.link.findMany({
    where: collection ? { id: { in: collection.linkIds } } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      rating: true,
      urgency: true,
      notes: true,
      reviewNote: true,
      tandoorRecipeId: true,
      category: true,
      categoryStatus: true,
      createdAt: true,
      submittedById: true,
      mediaStatus: true,
      submittedBy: { select: { name: true, email: true } },
      mediaAsset: true,
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        {!collection && (
          <div className="animate-slide-up">
            <div className="glass-card rounded-xl p-6">
              <h2 className="font-heading text-xl italic text-foreground mb-4">
                Share a link
              </h2>
              <SubmitLinkForm />
            </div>
          </div>
        )}
        <div className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <Dashboard
            links={links}
            currentUserId={session.user.id}
            tandoorUrl={process.env.TANDOOR_URL}
            collection={collection}
            expiredToken={expiredToken}
          />
        </div>
      </main>
    </div>
  );
}
```

Note: the submit form is hidden in collection mode so the shared view stays focused on the selected recipes.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: TS error that `Dashboard` does not accept `collection`/`expiredToken` yet — that is fixed in Task 10. (Acceptable intermediate state; do not commit until Task 10.)

---

### Task 10: Dashboard select mode + collection mode

**Files:**
- Modify: `src/components/dashboard.tsx`

- [ ] **Step 1: Extend props + add select/collection state**

Update the `Dashboard` signature and add imports/state:

```tsx
import { useMemo, useState } from "react";
import { LinkCard } from "@/components/link-card";
import { type LinkItem, type Category, type Urgency, type SharedCollectionView } from "@/types/link";
import { searchLinks } from "@/lib/search-links";
import { createSharedCollection } from "@/lib/actions";
```

```tsx
export function Dashboard({
  links,
  currentUserId,
  tandoorUrl,
  collection = null,
  expiredToken = false,
}: {
  links: LinkItem[];
  currentUserId: string;
  tandoorUrl?: string;
  collection?: SharedCollectionView | null;
  expiredToken?: boolean;
}) {
  const collectionMode = collection !== null;

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // ...existing filter state (ratings, categories, urgencies, tandoorOnly, filtersOpen, searchQuery)
```

- [ ] **Step 2: Add the create-link handler**

Inside the component, before `return`:

```tsx
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateLink() {
    setCreating(true);
    const result = await createSharedCollection([...selectedIds]);
    setCreating(false);
    if ("token" in result) {
      setShareUrl(`${window.location.origin}/?c=${result.token}`);
    } else {
      setShareUrl(null);
      alert(result.error);
    }
  }
```

- [ ] **Step 3: Render the collection banner / expired notice**

At the very top of the returned JSX (inside the outer `<div className="space-y-5">`), add:

```tsx
      {expiredToken && (
        <div className="glass-card rounded-xl px-4 py-3 text-sm text-red-400">
          This share link has expired.
        </div>
      )}
      {collection && (
        <div className="glass-card rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Shared collection · {links.length} recipe{links.length !== 1 ? "s" : ""}
            <span className="mx-1.5 opacity-40">·</span>
            expires in {collection.hoursLeft}h
          </p>
          <a href="/" className="text-xs font-medium text-coral hover:underline">
            View all
          </a>
        </div>
      )}
```

- [ ] **Step 4: Hide the filter bar in collection mode; add Select toggle otherwise**

Wrap the existing filter-bar `<div className="glass-card rounded-xl overflow-hidden">...</div>` so it only renders when `!collectionMode`. Immediately above it (still only when `!collectionMode`), add a row with the Select toggle:

```tsx
      {!collectionMode && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelectedIds(new Set());
              setShareUrl(null);
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            {selectMode ? "Cancel selection" : "Select recipes"}
          </button>
          {selectMode && (
            <span className="text-xs text-muted-foreground/60">{selectedIds.size} selected</span>
          )}
        </div>
      )}
      {!collectionMode && (
        <div className="glass-card rounded-xl overflow-hidden">
          {/* ...existing search + filters block unchanged... */}
        </div>
      )}
```

- [ ] **Step 5: Add checkboxes to cards in select mode**

In the cards grid, wrap each `LinkCard` so select mode shows a checkbox overlay and clicking toggles selection instead of leaving the card fully interactive:

```tsx
          {filtered.map((link, i) => (
            <div
              key={link.id}
              className="animate-card-enter relative"
              style={{
                animationDelay: `${Math.min(i, 12) * 60}ms`,
                contentVisibility: "auto",
                containIntrinsicSize: "auto 420px",
              }}
            >
              {selectMode && (
                <button
                  onClick={() => toggleSelected(link.id)}
                  aria-pressed={selectedIds.has(link.id)}
                  className="absolute top-2 left-2 z-10 w-7 h-7 rounded-md border-2 flex items-center justify-center backdrop-blur-sm transition-colors"
                  style={
                    selectedIds.has(link.id)
                      ? { borderColor: "oklch(0.55 0.15 145)", background: "oklch(0.55 0.15 145 / 25%)" }
                      : { borderColor: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.35)" }
                  }
                >
                  {selectedIds.has(link.id) && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-4 h-4">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )}
              <div className={selectMode ? "pointer-events-none" : undefined}>
                <LinkCard link={link} canReview={true} tandoorUrl={tandoorUrl} />
              </div>
            </div>
          ))}
```

Note: `canReview` stays `true` in both the normal and shared (collection) views — per the design, collection mode keeps full rate/edit interaction. Select mode disables interaction via the `pointer-events-none` wrapper, not via `canReview`.

- [ ] **Step 6: Add the floating create-link bar**

At the end of the outer returned `<div>` (after the cards grid), add:

```tsx
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-4">
          <div className="glass-card rounded-full px-4 py-2 flex items-center gap-3 shadow-lg">
            <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
            <button
              onClick={handleCreateLink}
              disabled={creating}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-green-500/40 bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create 24h link"}
            </button>
          </div>
        </div>
      )}
      {shareUrl && (
        <div className="fixed bottom-20 inset-x-0 z-30 flex justify-center px-4">
          <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-2 max-w-md w-full">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 bg-background/50 border border-border/60 rounded-lg px-2 py-1.5 text-xs outline-none"
            />
            <button
              onClick={() => navigator.clipboard.writeText(shareUrl)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border/60 hover:text-foreground"
            >
              Copy
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (Task 9's page now type-checks against the new props).

- [ ] **Step 8: Manual verification**

Run `npm run dev`:
1. Click "Select recipes" → checkboxes appear, cards stop being interactive.
2. Select 3 recipes → floating bar shows "3 selected" + "Create 24h link".
3. Click it → a `/?c=<token>` URL appears with a Copy button.
4. Open that URL in a new tab (same login) → dashboard shows only those 3 recipes, no filter bar, banner "Shared collection · 3 recipes · expires in 24h", "View all" returns to `/`. Rating a recipe still works.
5. Open `/?c=bogus` → banner "This share link has expired." and the full dashboard renders.

- [ ] **Step 9: Commit (Tasks 9 + 10 together)**

```bash
git add src/app/page.tsx src/components/dashboard.tsx
git commit -m "feat(collections): select recipes and view shared 24h collection links"
```

---

### Task 11: Expiry verification

**Files:** none (verification only)

- [ ] **Step 1: Verify expiry path**

Temporarily create a collection with a past `expiresAt` to confirm the resolver returns null and the page shows the expired notice. In a scratch node script (or `npm run db:studio`), insert a `SharedCollection` row with `expiresAt` in the past and at least one valid `linkIds` entry, then open `/?c=<that id>`. Expected: expired notice + full dashboard, and the row is cleaned up by the opportunistic `deleteMany` on next access. Report the result. (No code/commit.)

---

## Final verification

- [ ] Run the full test suite: `npm run test` → all pass.
- [ ] Run `npx tsc --noEmit` → no errors.
- [ ] Run `npm run lint` → no new errors.
- [ ] Memory: with the full list loaded, scroll top-to-bottom; confirm JS heap plateaus and there are zero `<iframe>` elements in the recipe list.

---

## Spec coverage map

- Leak — inline iframes → Task 2. Windowing → Task 3. OG concurrency → Task 4. Payload → Task 5.
- Data model → Task 6. Helpers/validation → Task 7. Create + resolver + lazy cleanup → Task 8. Token read + scoping → Task 9. Select mode + collection mode + banner + full interaction → Task 10. Expiry behavior → Tasks 8 + 11.
- Auth gating → inherited from `page.tsx` redirect (no task needed).
