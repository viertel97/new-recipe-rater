# Phase 1: Swipe Engine Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the mid-swipe card jump and the video-reset on the freshly-active card by introducing a stable, snapshot-based swipe queue and a shared client-side media cache.

**Architecture:** A new `useSwipeQueue` hook owns the swipe session state — snapshot of `initialLinks` taken once on mount, plus a local `ratedIds` set. The hook ignores subsequent `initialLinks` prop updates, so server-action revalidation can no longer reorder the visible queue. `swipe-view` and `swipe-card` are refactored to delegate queue logic to the hook and media fetching to a shared `MediaCache` (in-memory `Map` with a concurrency limiter), so back-cards never flash "Loading..." after their first fetch.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Vitest + @testing-library/react (new), existing `lib/actions.ts` server action.

**Spec:** `docs/superpowers/specs/2026-05-07-mobile-swipe-v2-design.md` §6.

---

## File map

| Path | Status | Responsibility |
|---|---|---|
| `src/lib/swipe-queue.ts` | create | `useSwipeQueue` hook — snapshot, filter, advance, rate |
| `src/lib/media-cache.ts` | create | Shared in-memory media cache with concurrency limiter |
| `src/components/swipe-view.tsx` | modify | Delegate queue logic to `useSwipeQueue`, drop `index`/preload |
| `src/components/swipe-card.tsx` | modify | Accept optional `media` prop (Phase 2 lookahead), use `MediaCache`, fix mute bug |
| `src/lib/__tests__/swipe-queue.test.ts` | create | Unit tests for the hook |
| `src/lib/__tests__/media-cache.test.ts` | create | Unit tests for the cache |
| `vitest.config.ts` | create | Vitest config with jsdom + path aliases |
| `vitest.setup.ts` | create | Test setup (jsdom matchers, fetch polyfill) |
| `package.json` | modify | Add vitest devDeps + `test` script |

---

## Task 1: Add Vitest test runner

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest and testing-library dependencies**

```bash
npm install --save-dev vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

Expected: dependencies added under `devDependencies`.

- [ ] **Step 2: Create `vitest.config.ts`**

Content:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Create `vitest.setup.ts`**

Content:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add `test` script in `package.json`**

Modify the `"scripts"` block to add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify the runner works (no tests yet → passes vacuously)**

Run: `npm test`
Expected: vitest exits 0 with "No test files found" (acceptable).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts vitest.setup.ts package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

## Task 2: `useSwipeQueue` — snapshot stability test

**Files:**
- Test: `src/lib/__tests__/swipe-queue.test.ts`
- Create: `src/lib/swipe-queue.ts` (skeleton)

- [ ] **Step 1: Write the failing test for snapshot stability**

Create `src/lib/__tests__/swipe-queue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwipeQueue } from "@/lib/swipe-queue";
import type { LinkItem } from "@/types/link";

vi.mock("@/lib/actions", () => ({
  rateLink: vi.fn().mockResolvedValue({ success: true }),
}));

function makeLink(id: string, category: LinkItem["category"] = null): LinkItem {
  return {
    id,
    url: `https://example.com/${id}`,
    rating: "PENDING",
    urgency: null,
    notes: null,
    reviewNote: null,
    tandoorRecipeId: null,
    category,
    categoryStatus: "DONE",
    createdAt: new Date("2026-01-01"),
    submittedById: "u1",
    submittedBy: { name: "Alice", email: null },
  };
}

const noFilter = { categories: [], includeUncategorized: true };

describe("useSwipeQueue", () => {
  it("snapshots initialLinks on first mount and ignores later prop updates", () => {
    const A = makeLink("A"), B = makeLink("B"), C = makeLink("C"), D = makeLink("D");
    const { result, rerender } = renderHook(
      ({ links }) => useSwipeQueue(links, noFilter),
      { initialProps: { links: [A, B, C, D] } }
    );

    expect(result.current.active?.id).toBe("A");
    expect(result.current.next?.id).toBe("B");

    // Server revalidation arrives with reordered/filtered list — hook must ignore it
    rerender({ links: [B, C, D] });
    expect(result.current.active?.id).toBe("A");
    expect(result.current.next?.id).toBe("B");
  });
});
```

- [ ] **Step 2: Create `src/lib/swipe-queue.ts` skeleton (just enough to make the test fail with a clear error)**

```ts
import type { LinkItem, Category, Urgency } from "@/types/link";

export type SwipeFilters = {
  categories: Category[];
  includeUncategorized: boolean;
};

export type SwipeQueue = {
  active: LinkItem | null;
  next: LinkItem | null;
  remaining: number;
  stats: { liked: number; noped: number };
  rate: (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => void;
};

export function useSwipeQueue(_initialLinks: LinkItem[], _filters: SwipeFilters): SwipeQueue {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npm test -- swipe-queue`
Expected: FAIL with "not implemented".

- [ ] **Step 4: Implement the snapshot behaviour**

Replace the body of `useSwipeQueue` in `src/lib/swipe-queue.ts`:

```ts
import { useState, useMemo, useCallback, startTransition } from "react";
import type { LinkItem, Category, Urgency } from "@/types/link";
import { rateLink } from "@/lib/actions";

export type SwipeFilters = {
  categories: Category[];
  includeUncategorized: boolean;
};

export type SwipeQueue = {
  active: LinkItem | null;
  next: LinkItem | null;
  remaining: number;
  stats: { liked: number; noped: number };
  rate: (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => void;
};

function matchesFilter(link: LinkItem, f: SwipeFilters): boolean {
  const noConstraint = f.categories.length === 0 && f.includeUncategorized;
  if (noConstraint) return true;
  if (link.category == null) return f.includeUncategorized;
  return f.categories.includes(link.category);
}

export function useSwipeQueue(initialLinks: LinkItem[], filters: SwipeFilters): SwipeQueue {
  const [snapshot] = useState<LinkItem[]>(() => initialLinks);
  const [ratedIds, setRatedIds] = useState<Set<string>>(() => new Set());
  const [stats, setStats] = useState({ liked: 0, noped: 0 });

  const visible = useMemo(
    () => snapshot.filter((l) => !ratedIds.has(l.id) && matchesFilter(l, filters)),
    [snapshot, ratedIds, filters]
  );

  const rate = useCallback(
    (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => {
      setRatedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setStats((s) => (rating === "GOOD" ? { ...s, liked: s.liked + 1 } : { ...s, noped: s.noped + 1 }));
      startTransition(() => {
        rateLink(id, rating, opts);
      });
    },
    []
  );

  return {
    active: visible[0] ?? null,
    next: visible[1] ?? null,
    remaining: visible.length,
    stats,
    rate,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- swipe-queue`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/swipe-queue.ts src/lib/__tests__/swipe-queue.test.ts
git commit -m "feat(swipe): add snapshot-based useSwipeQueue hook"
```

---

## Task 3: `useSwipeQueue` — filter logic tests

**Files:**
- Modify: `src/lib/__tests__/swipe-queue.test.ts`

- [ ] **Step 1: Add filter tests**

Append inside the `describe("useSwipeQueue", ...)` block:

```ts
it("filters by categories when provided", () => {
  const dinner = makeLink("d", "DINNER");
  const snack = makeLink("s", "SNACK");
  const cake = makeLink("c", "CAKE");
  const { result } = renderHook(() =>
    useSwipeQueue([dinner, snack, cake], {
      categories: ["DINNER", "CAKE"],
      includeUncategorized: false,
    })
  );

  expect(result.current.active?.id).toBe("d");
  expect(result.current.next?.id).toBe("c");
  expect(result.current.remaining).toBe(2);
});

it("includeUncategorized=true with empty categories shows everything", () => {
  const dinner = makeLink("d", "DINNER");
  const uncat = makeLink("u", null);
  const { result } = renderHook(() =>
    useSwipeQueue([dinner, uncat], { categories: [], includeUncategorized: true })
  );

  expect(result.current.remaining).toBe(2);
});

it("includeUncategorized=false with empty categories shows nothing", () => {
  const dinner = makeLink("d", "DINNER");
  const uncat = makeLink("u", null);
  const { result } = renderHook(() =>
    useSwipeQueue([dinner, uncat], { categories: [], includeUncategorized: false })
  );

  expect(result.current.remaining).toBe(0);
  expect(result.current.active).toBeNull();
});

it("includes uncategorized when toggle is on alongside category filter", () => {
  const dinner = makeLink("d", "DINNER");
  const uncat = makeLink("u", null);
  const snack = makeLink("s", "SNACK");
  const { result } = renderHook(() =>
    useSwipeQueue([dinner, uncat, snack], {
      categories: ["DINNER"],
      includeUncategorized: true,
    })
  );

  expect(result.current.remaining).toBe(2);
  expect(result.current.active?.id).toBe("d");
  expect(result.current.next?.id).toBe("u");
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- swipe-queue`
Expected: PASS (all filter cases).

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/swipe-queue.test.ts
git commit -m "test(swipe): cover useSwipeQueue filter logic"
```

---

## Task 4: `useSwipeQueue` — rate advances queue

**Files:**
- Modify: `src/lib/__tests__/swipe-queue.test.ts`

- [ ] **Step 1: Add rate-advance test**

Append inside the `describe(...)` block:

```ts
import { act } from "@testing-library/react";

it("rate() advances the visible queue and updates stats", () => {
  const A = makeLink("A"), B = makeLink("B"), C = makeLink("C");
  const { result } = renderHook(() => useSwipeQueue([A, B, C], noFilter));

  expect(result.current.active?.id).toBe("A");

  act(() => {
    result.current.rate("A", "GOOD");
  });

  expect(result.current.active?.id).toBe("B");
  expect(result.current.next?.id).toBe("C");
  expect(result.current.stats.liked).toBe(1);
  expect(result.current.remaining).toBe(2);

  act(() => {
    result.current.rate("B", "BAD");
  });

  expect(result.current.active?.id).toBe("C");
  expect(result.current.next).toBeNull();
  expect(result.current.stats.noped).toBe(1);
});

it("calls rateLink server action with correct args", async () => {
  const { rateLink } = await import("@/lib/actions");
  const A = makeLink("A");
  const { result } = renderHook(() => useSwipeQueue([A], noFilter));

  act(() => {
    result.current.rate("A", "GOOD", { urgency: "NEXT_WEEK" });
  });

  expect(rateLink).toHaveBeenCalledWith("A", "GOOD", { urgency: "NEXT_WEEK" });
});

it("rate() is idempotent on duplicate id", () => {
  const A = makeLink("A"), B = makeLink("B");
  const { result } = renderHook(() => useSwipeQueue([A, B], noFilter));

  act(() => {
    result.current.rate("A", "GOOD");
    result.current.rate("A", "GOOD");
  });

  expect(result.current.stats.liked).toBe(1);
  expect(result.current.active?.id).toBe("B");
});
```

Update the existing import at the top of the file to include `act`. Replace:

```ts
import { renderHook } from "@testing-library/react";
```

with:

```ts
import { renderHook, act } from "@testing-library/react";
```

(Remove the duplicate `import { act }` line that appears inside the test block — keep it only at the top.)

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- swipe-queue`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/swipe-queue.test.ts
git commit -m "test(swipe): cover rate() advance and server-action call"
```

---

## Task 5: `MediaCache` — implementation + tests

**Files:**
- Create: `src/lib/media-cache.ts`
- Create: `src/lib/__tests__/media-cache.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/__tests__/media-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MediaCache } from "@/lib/media-cache";
import type { LinkItem } from "@/types/link";

function makeLink(id: string, url: string): LinkItem {
  return {
    id,
    url,
    rating: "PENDING",
    urgency: null,
    notes: null,
    reviewNote: null,
    tandoorRecipeId: null,
    category: null,
    categoryStatus: "DONE",
    createdAt: new Date("2026-01-01"),
    submittedById: "u1",
    submittedBy: { name: null, email: null },
  };
}

describe("MediaCache", () => {
  beforeEach(() => {
    MediaCache._reset();
    vi.restoreAllMocks();
  });

  it("dedups concurrent calls for the same link", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ media: [{ url: "https://cdn/x.mp4", type: "video" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const link = makeLink("L1", "https://instagram.com/p/abc/");
    const [a, b] = await Promise.all([MediaCache.get(link), MediaCache.get(link)]);

    expect(a).toEqual(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches the resolved value for subsequent calls", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "T", image: null, description: null, siteName: null }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const link = makeLink("L2", "https://example.com/recipe");
    await MediaCache.get(link);
    await MediaCache.get(link);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches null on fetch failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);

    const link = makeLink("L3", "https://example.com/x");
    const result = await MediaCache.get(link);

    expect(result).toBeNull();
    // Second call should not refetch
    await MediaCache.get(link);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("limits in-flight requests to 2", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchSpy = vi.fn().mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve({ ok: true, json: async () => ({ title: "x", image: null, description: null, siteName: null }) });
        }, 10)
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const links = Array.from({ length: 5 }, (_, i) => makeLink(`L${i}`, `https://example.com/${i}`));
    await Promise.all(links.map((l) => MediaCache.get(l)));

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Create `src/lib/media-cache.ts` skeleton**

```ts
import type { LinkItem, OgData } from "@/types/link";

export type CachedMedia =
  | { type: "video"; videoUrl: string; thumbnail?: string }
  | { type: "image"; ogData: OgData }
  | null;

export const MediaCache = {
  get(_link: LinkItem): Promise<CachedMedia> {
    throw new Error("not implemented");
  },
  warm(_link: LinkItem): void {
    throw new Error("not implemented");
  },
  _reset(): void {
    throw new Error("not implemented");
  },
};
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- media-cache`
Expected: FAIL with "not implemented".

- [ ] **Step 4: Implement `MediaCache`**

Replace `src/lib/media-cache.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- media-cache`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/media-cache.ts src/lib/__tests__/media-cache.test.ts
git commit -m "feat(swipe): add shared MediaCache with concurrency limiter"
```

---

## Task 6: Refactor `SwipeCard` to use `MediaCache` + fix mute bug

**Files:**
- Modify: `src/components/swipe-card.tsx`

- [ ] **Step 1: Replace imports and `useMediaData` with `MediaCache`-backed `useCardMedia`**

Replace the import block and the `MediaData` / `useMediaData` definitions (lines 1–70 in the current file) with:

```tsx
"use client";

import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { type LinkItem, type Category } from "@/types/link";
import { MediaCache, type CachedMedia } from "@/lib/media-cache";

export type SwipeCardHandle = {
  triggerSwipe: (direction: "left" | "right") => void;
};

const categoryColors: Record<Category, string> = {
  DINNER: "oklch(0.65 0.14 45)",
  SNACK: "oklch(0.70 0.12 75)",
  CAKE: "oklch(0.70 0.14 350)",
  BREAKFAST: "oklch(0.75 0.12 90)",
};

const categoryLabels: Record<Category, string> = {
  DINNER: "Dinner",
  SNACK: "Snack",
  CAKE: "Cake",
  BREAKFAST: "Breakfast",
};

const SWIPE_THRESHOLD = 0.3;
const MAX_ROTATION = 15;
const ROTATION_FACTOR = 0.06;

type MediaState =
  | { type: "loading" }
  | { type: "video"; videoUrl: string; thumbnail?: string }
  | { type: "image"; image: string | null; title: string | null; siteName: string | null }
  | { type: "error" };

function useCardMedia(link: LinkItem): MediaState {
  const [state, setState] = useState<MediaState>({ type: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ type: "loading" });
    MediaCache.get(link).then((cached: CachedMedia) => {
      if (cancelled) return;
      if (!cached) return setState({ type: "error" });
      if (cached.type === "video") {
        return setState({ type: "video", videoUrl: cached.videoUrl, thumbnail: cached.thumbnail });
      }
      setState({
        type: "image",
        image: cached.ogData.image,
        title: cached.ogData.title,
        siteName: cached.ogData.siteName,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [link]);

  return state;
}
```

- [ ] **Step 2: Replace the `forwardRef` body**

Find the existing `export const SwipeCard = forwardRef<...>(...)` declaration and replace it with the version below. The visible UI is unchanged; only the data plumbing differs.

```tsx
export const SwipeCard = forwardRef<SwipeCardHandle, {
  link: LinkItem;
  onSwipe: (direction: "left" | "right") => void;
  active: boolean;
}>(function SwipeCard({ link, onSwipe, active }, ref) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const currentX = useRef(0);
  const [deltaX, setDeltaX] = useState(0);
  const [flying, setFlying] = useState<"left" | "right" | null>(null);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = useCardMedia(link);

  // Sync imperative video.muted with React state — fixes stale-read bug
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const screenWidth = typeof window !== "undefined" ? window.innerWidth : 400;
  const threshold = screenWidth * SWIPE_THRESHOLD;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active || flying) return;
    dragging.current = true;
    startX.current = e.clientX;
    currentX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [active, flying]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    currentX.current = e.clientX;
    setDeltaX(currentX.current - startX.current);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const dx = currentX.current - startX.current;

    if (Math.abs(dx) > threshold) {
      const direction = dx > 0 ? "right" : "left";
      setFlying(direction);
      setTimeout(() => onSwipe(direction), 300);
    } else {
      setDeltaX(0);
    }
  }, [threshold, onSwipe]);

  const triggerSwipe = useCallback((direction: "left" | "right") => {
    setFlying(direction);
    setTimeout(() => onSwipe(direction), 300);
  }, [onSwipe]);

  useImperativeHandle(ref, () => ({ triggerSwipe }), [triggerSwipe]);

  const isNonVideoCard = media.type === "image" || media.type === "error";

  const rotation = Math.min(MAX_ROTATION, Math.max(-MAX_ROTATION, deltaX * ROTATION_FACTOR));
  const stampOpacity = Math.min(1, Math.abs(deltaX) / threshold);
  const isRight = deltaX > 0;

  const flyX = flying === "right" ? screenWidth * 1.5 : flying === "left" ? -screenWidth * 1.5 : 0;
  const flyRotation = flying ? (flying === "right" ? MAX_ROTATION : -MAX_ROTATION) : 0;

  const domain = (() => {
    try { return new URL(link.url).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  })();

  const submitterName = link.submittedBy.name || link.submittedBy.email || "Unknown";
  const dateStr = new Date(link.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div
      ref={cardRef}
      className="absolute inset-0 touch-none select-none"
      style={{
        transform: flying
          ? `translateX(${flyX}px) rotate(${flyRotation}deg)`
          : `translateX(${deltaX}px) rotate(${rotation}deg)`,
        transition: flying
          ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
          : dragging.current
            ? "none"
            : "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        opacity: flying ? 0 : 1,
        zIndex: active ? 10 : 0,
        pointerEvents: active ? "auto" : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="absolute inset-0 bg-background overflow-hidden">
        {media.type === "video" && (
          <video
            ref={videoRef}
            src={media.videoUrl}
            poster={media.thumbnail}
            autoPlay
            muted={muted}
            playsInline
            loop
            className="w-full h-full object-cover"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
          />
        )}
        {media.type === "image" && media.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.image} alt={media.title || ""} className="w-full h-full object-cover" />
        )}
        {media.type === "image" && !media.image && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              className="w-16 h-16 rounded-xl opacity-60"
            />
            <p className="text-sm text-muted-foreground font-medium">{domain}</p>
            {media.title && (
              <p className="text-lg font-semibold text-foreground text-center px-8 line-clamp-3">{media.title}</p>
            )}
          </div>
        )}
        {media.type === "loading" && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-muted-foreground/40 text-sm">Loading...</div>
          </div>
        )}
        {media.type === "error" && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <p className="text-muted-foreground/60 text-sm">Could not load media</p>
            <p className="text-xs text-muted-foreground/40">{domain}</p>
          </div>
        )}
      </div>

      {deltaX !== 0 && !flying && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: isRight
              ? `oklch(0.55 0.15 145 / ${stampOpacity * 0.15})`
              : `oklch(0.65 0.2 20 / ${stampOpacity * 0.15})`,
          }}
        />
      )}

      {isNonVideoCard && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-5"
          onClick={(e) => {
            if (Math.abs(deltaX) > 5) e.preventDefault();
          }}
        />
      )}

      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "50%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
        }}
      />

      {media.type === "video" && (
        <div className="absolute top-4 right-4 z-20 pointer-events-none">
          <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            {muted ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </div>
        </div>
      )}

      <div className="absolute bottom-20 left-0 right-0 px-5 z-10 pointer-events-none">
        {link.category && (
          <span
            className="inline-block text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded-full mb-2"
            style={{
              background: `color-mix(in oklch, ${categoryColors[link.category]} 20%, transparent)`,
              color: categoryColors[link.category],
              border: `1px solid color-mix(in oklch, ${categoryColors[link.category]} 30%, transparent)`,
            }}
          >
            {categoryLabels[link.category]}
          </span>
        )}
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/50 font-medium mb-1">{domain}</p>
        <p className="text-base font-semibold text-white line-clamp-2 leading-snug">
          {(media.type === "image" && media.title) || link.url}
        </p>
        <p className="text-xs text-white/40 mt-1.5">
          {submitterName} · {dateStr}
        </p>
      </div>

      <div
        className="absolute top-20 left-6 z-20 pointer-events-none"
        style={{ opacity: isRight ? stampOpacity : 0 }}
      >
        <span className="swipe-stamp" style={{ color: "oklch(0.55 0.15 145)", borderColor: "oklch(0.55 0.15 145)" }}>
          LIKE
        </span>
      </div>

      <div
        className="absolute top-20 right-6 z-20 pointer-events-none"
        style={{ opacity: !isRight ? stampOpacity : 0, transform: "rotate(12deg)" }}
      >
        <span className="swipe-stamp" style={{ color: "oklch(0.65 0.2 20)", borderColor: "oklch(0.65 0.2 20)" }}>
          NOPE
        </span>
      </div>
    </div>
  );
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/swipe-card.tsx
git commit -m "refactor(swipe): route SwipeCard media through shared MediaCache, fix mute sync"
```

---

## Task 7: Refactor `SwipeView` to use `useSwipeQueue`

**Files:**
- Modify: `src/components/swipe-view.tsx`

- [ ] **Step 1: Replace `swipe-view.tsx` contents**

Overwrite the entire file with:

```tsx
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { type LinkItem, type Urgency } from "@/types/link";
import { useSwipeQueue, type SwipeFilters } from "@/lib/swipe-queue";
import { MediaCache } from "@/lib/media-cache";
import { SwipeCard, type SwipeCardHandle } from "@/components/swipe-card";
import { UrgencySheet } from "@/components/urgency-sheet";

const NO_FILTER: SwipeFilters = { categories: [], includeUncategorized: true };

export function SwipeView({ links }: { links: LinkItem[] }) {
  const { active, next, remaining, stats, rate } = useSwipeQueue(links, NO_FILTER);
  const [showUrgency, setShowUrgency] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const pendingSwipeId = useRef<string | null>(null);
  const activeCardRef = useRef<SwipeCardHandle>(null);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Warm the back card's media before promotion
  useEffect(() => {
    if (next) MediaCache.warm(next);
  }, [next]);

  const handleSwipe = useCallback((direction: "left" | "right") => {
    if (!active) return;
    if (direction === "left") {
      rate(active.id, "BAD");
    } else {
      pendingSwipeId.current = active.id;
      setShowUrgency(true);
    }
  }, [active, rate]);

  const handleUrgencySelect = useCallback((urgency: Urgency) => {
    if (pendingSwipeId.current) {
      rate(pendingSwipeId.current, "GOOD", { urgency });
    }
    pendingSwipeId.current = null;
    setShowUrgency(false);
  }, [rate]);

  const handleUrgencySkip = useCallback(() => {
    if (pendingSwipeId.current) {
      rate(pendingSwipeId.current, "GOOD");
    }
    pendingSwipeId.current = null;
    setShowUrgency(false);
  }, [rate]);

  const triggerButtonSwipe = useCallback((direction: "left" | "right") => {
    activeCardRef.current?.triggerSwipe(direction);
  }, []);

  if (isDesktop) {
    return (
      <div className="h-dvh bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-sm">Open on your phone to swipe</p>
        <a
          href="/"
          className="text-xs px-4 py-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to dashboard
        </a>
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="h-dvh bg-background flex flex-col items-center justify-center text-center px-8 gap-4">
        <div className="text-5xl opacity-80">🍽️</div>
        <p className="text-base font-semibold text-foreground/80">No recipes to rate</p>
        <p className="text-xs text-muted-foreground/50 leading-relaxed max-w-[240px]">
          Add some recipe links from Instagram or the web, then come back to swipe.
        </p>
        <a
          href="/"
          className="mt-2 px-6 py-2.5 rounded-xl text-xs font-medium border border-border/60 text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          Back to dashboard
        </a>
      </div>
    );
  }

  if (remaining === 0) {
    return (
      <div className="h-dvh bg-background flex flex-col items-center justify-center text-center px-8 gap-4">
        <div className="text-5xl opacity-80">🎉</div>
        <p className="text-base font-semibold text-foreground/80">All caught up!</p>
        <p className="text-xs text-muted-foreground/50 leading-relaxed">You&apos;ve rated all pending recipes.</p>
        <div className="flex gap-6 mt-2">
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "oklch(0.55 0.15 145)" }}>{stats.liked}</p>
            <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40">Liked</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "oklch(0.65 0.2 20)" }}>{stats.noped}</p>
            <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40">Noped</p>
          </div>
        </div>
        <a
          href="/"
          className="mt-4 px-6 py-2.5 rounded-xl text-xs font-medium border border-border/60 text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          Back to dashboard
        </a>
      </div>
    );
  }

  return (
    <div
      className="h-dvh bg-background overflow-hidden relative"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <a href="/" className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-5 h-5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </a>
        <span className="text-xs text-white/50 font-medium bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-full">
          {remaining} left
        </span>
      </div>

      <div className="absolute inset-0">
        {next && (
          <SwipeCard
            key={next.id}
            link={next}
            onSwipe={() => {}}
            active={false}
          />
        )}
        {active && (
          <SwipeCard
            key={active.id}
            ref={activeCardRef}
            link={active}
            onSwipe={handleSwipe}
            active={!showUrgency}
          />
        )}
      </div>

      {showUrgency && (
        <UrgencySheet onSelect={handleUrgencySelect} onSkip={handleUrgencySkip} />
      )}

      {!showUrgency && active && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center gap-8 pb-6"
          style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => triggerButtonSwipe("left")}
            className="w-16 h-16 rounded-full border-2 flex items-center justify-center active:scale-90 transition-transform"
            style={{ borderColor: "oklch(0.65 0.2 20 / 60%)", background: "oklch(0.65 0.2 20 / 10%)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="oklch(0.65 0.2 20)" strokeWidth="2.5" className="w-7 h-7">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <button
            onClick={() => triggerButtonSwipe("right")}
            className="w-16 h-16 rounded-full border-2 flex items-center justify-center active:scale-90 transition-transform"
            style={{ borderColor: "oklch(0.55 0.15 145 / 60%)", background: "oklch(0.55 0.15 145 / 10%)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.15 145)" strokeWidth="2.5" className="w-7 h-7">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
```

Key changes from the previous file:
- `index` state and the `index+1` / `index+2` preload `useEffect` removed.
- Render two `SwipeCard` instances explicitly: `next` first (back), then `active` on top, both keyed by link id. `next` receives a no-op `onSwipe` because it's not draggable until promoted.
- Counter changed from `{index + 1} of {links.length}` to `{remaining} left` — `index` no longer exists and `remaining` is more honest.
- Empty state condition now `links.length === 0` (initial mount empty) — completion uses `remaining === 0`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all pass (queue + cache).

- [ ] **Step 4: Commit**

```bash
git add src/components/swipe-view.tsx
git commit -m "refactor(swipe): use useSwipeQueue + MediaCache in SwipeView"
```

---

## Task 8: Manual smoke test on `/swipe`

**Files:** none (verification only)

- [ ] **Step 1: Boot dev server**

Run: `npm run dev`
Wait for `Ready` log line at `http://localhost:3000`.

- [ ] **Step 2: Seed pending data if needed**

If the database has no pending links, run:

```bash
npm run db:seed
```

Then submit a few Instagram + web URLs from the dashboard.

- [ ] **Step 3: Open `/swipe` on a phone-sized viewport (DevTools device toolbar, iPhone 14 preset is fine)**

Verify the visible behaviour:

| Check | Expected |
|---|---|
| First card loads | Active card shows media (image or video); next card shows behind it |
| Swipe left (or click X) | Card flies off, next card promoted, **no jump**, **no Loading flash** for the now-active card |
| Swipe right → urgency sheet appears | Sheet slides up, active card unchanged behind |
| Pick urgency | Sheet closes, next card promoted seamlessly |
| Counter | Shows `N left` and decrements on each rate |
| Video card → tap video | Toggles mute icon; audio actually toggles |
| Server-action mid-swipe | Network panel shows `rateLink` POST; visible queue does **not** reorder when it returns |
| Hit "All caught up!" | Stats reflect actual liked/noped counts |

- [ ] **Step 4: Document any deviation**

If any check fails, note the exact behaviour observed and fix before continuing. Do **not** mark this task complete until all checks pass.

- [ ] **Step 5: Commit (if any fix-up was needed)**

```bash
git add <changed files>
git commit -m "fix(swipe): <what was fixed>"
```

If no fix-up was needed, skip the commit.

---

## Definition of done

- All test files pass via `npm test`.
- `npx tsc --noEmit` exits clean.
- Manual smoke checklist (Task 8) passes on a mobile-sized viewport.
- No `index`-based queue state remains anywhere in `src/components/swipe-view.tsx`.
- No direct `fetch("/api/instagram"...)` or `fetch("/api/og"...)` calls remain in `src/components/`. (`src/lib/media-cache.ts` is the sole client-side caller.)
- Server action `rateLink` is unchanged structurally; `revalidatePath("/")` still fires for dashboard freshness.

## Out of scope (deferred to later phases)

- Server-side media resolution (Phase 2).
- Persistent media on disk (Phase 2).
- PWA manifest + service worker (Phase 3).
- Category filter sheet UI (Phase 4) — the hook accepts filter input today but `swipe-view` hardcodes `NO_FILTER`.
- Dashboard / add-page polish (Phase 5).
