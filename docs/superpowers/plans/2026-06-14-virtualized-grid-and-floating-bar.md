# Virtualized Recipe Grid + Floating Select Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only on-screen recipe cards (window virtualization, no new dependency) so 300+ entries no longer mount at once, and make the select action bar truly float against the viewport while scrolling.

**Architecture:** Pure, unit-tested geometry helpers (`src/lib/virtual-grid.ts`) feed a client hook (`src/components/use-window-virtual-grid.ts`) that virtualizes against `window` scroll. The dashboard chunks `filtered` into rows of `columns` (1/2/3 by breakpoint), renders only the visible row window inside a full-height spacer, and portals the floating bar to `document.body` so ancestor transforms (`.animate-slide-up`) can't trap it.

**Tech Stack:** Next.js 16 (client component), React 19, Tailwind v4, Vitest. No new npm package (npm is broken in this env; pnpm-only, package-lock.json must stay valid).

**Constraints:**
- No new dependency. Custom virtualization only.
- The page itself scrolls (no inner scroll container) → virtualize against `window`.
- Card heights are variable (async OG images, expandable category badge) → measure rows with `ResizeObserver`, don't assume fixed height.
- Preserve all existing behavior: filters/search, select mode (checkbox overlay + `pointer-events-none` wrapper), collection mode, empty state.

---

### Task 1: Pure virtual-grid geometry helpers (TDD)

**Files:**
- Create: `src/lib/virtual-grid.ts`
- Test: `src/lib/__tests__/virtual-grid.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { rowCountFor, rowItemRange, prefixOffsets, visibleRowRange } from "@/lib/virtual-grid";

describe("rowCountFor", () => {
  it("ceil-divides items by columns", () => {
    expect(rowCountFor(0, 3)).toBe(0);
    expect(rowCountFor(7, 3)).toBe(3);
    expect(rowCountFor(6, 3)).toBe(2);
    expect(rowCountFor(1, 3)).toBe(1);
  });
  it("returns 0 for non-positive columns", () => {
    expect(rowCountFor(10, 0)).toBe(0);
  });
});

describe("rowItemRange", () => {
  it("returns [start, end) clamped to itemCount", () => {
    expect(rowItemRange(0, 3, 7)).toEqual([0, 3]);
    expect(rowItemRange(2, 3, 7)).toEqual([6, 7]);
  });
});

describe("prefixOffsets", () => {
  it("builds cumulative offsets with a trailing total", () => {
    expect(prefixOffsets([])).toEqual([0]);
    expect(prefixOffsets([100, 200, 50])).toEqual([0, 100, 300, 350]);
  });
});

describe("visibleRowRange", () => {
  const prefix = prefixOffsets([100, 100, 100, 100, 100]); // 5 rows, 500 tall

  it("returns [0,0] when no rows", () => {
    expect(visibleRowRange([0], 0, 800, 0)).toEqual([0, 0]);
  });
  it("includes rows intersecting the viewport at top with no overscan", () => {
    // viewport 0..250 -> rows 0,1,2 (row 2 spans 200..300)
    expect(visibleRowRange(prefix, 0, 250, 0)).toEqual([0, 3]);
  });
  it("scrolls the window down", () => {
    // scrollTop 220, viewport 100 -> visible 220..320 -> rows 2,3
    expect(visibleRowRange(prefix, 220, 100, 0)).toEqual([2, 4]);
  });
  it("applies overscan in px on both edges", () => {
    // scrollTop 220, viewport 100, overscan 120 -> 100..440 -> rows 1..4
    expect(visibleRowRange(prefix, 220, 100, 120)).toEqual([1, 5]);
  });
  it("clamps to the last row", () => {
    expect(visibleRowRange(prefix, 10000, 800, 0)).toEqual([5, 5]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `./node_modules/.bin/vitest run src/lib/__tests__/virtual-grid.test.ts` (module not found).

- [ ] **Step 3: Implement**

```ts
export function rowCountFor(itemCount: number, columns: number): number {
  if (columns <= 0) return 0;
  return Math.ceil(itemCount / columns);
}

export function rowItemRange(
  rowIndex: number,
  columns: number,
  itemCount: number,
): [number, number] {
  const start = rowIndex * columns;
  const end = Math.min(start + columns, itemCount);
  return [start, end];
}

// prefix[i] = top offset (px) of row i; prefix[rowCount] = total content height.
export function prefixOffsets(rowHeights: number[]): number[] {
  const prefix: number[] = new Array(rowHeights.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < rowHeights.length; i++) {
    prefix[i + 1] = prefix[i] + rowHeights[i];
  }
  return prefix;
}

// Half-open [startRow, endRow). scrollTop is window scrollY minus the list's top
// offset (may be negative; treated as scrolled-above-list). overscanPx pads both edges.
export function visibleRowRange(
  prefix: number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): [number, number] {
  const rowCount = prefix.length - 1;
  if (rowCount <= 0) return [0, 0];
  const top = scrollTop - overscanPx;
  const bottom = scrollTop + viewportHeight + overscanPx;
  let startRow = 0;
  while (startRow < rowCount && prefix[startRow + 1] <= top) startRow++;
  let endRow = startRow;
  while (endRow < rowCount && prefix[endRow] < bottom) endRow++;
  return [startRow, endRow];
}
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run src/lib/__tests__/virtual-grid.test.ts`. Then full suite `XDG_CACHE_HOME=/tmp/prisma-cache ./node_modules/.bin/vitest run` (expect 33 passing: prior 28 + 5 new).

- [ ] **Step 5: Commit** — `feat(virtual): pure grid geometry helpers`

---

### Task 2: `useWindowVirtualGrid` client hook

**Files:**
- Create: `src/components/use-window-virtual-grid.ts`

No unit test (DOM/window/ResizeObserver hook; verified via dev server in Task 5). Must compile under `tsc` and lint clean.

- [ ] **Step 1: Implement the hook**

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rowCountFor, prefixOffsets, visibleRowRange } from "@/lib/virtual-grid";

const ESTIMATE_ROW_HEIGHT = 440;
const OVERSCAN_PX = 600;

function columnsForWidth(width: number): number {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

export type VirtualRow = {
  rowIndex: number;
  start: number;
  measureRef: (el: HTMLElement | null) => void;
};

export function useWindowVirtualGrid(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(800);
  const [listTop, setListTop] = useState(0);
  const [version, setVersion] = useState(0);

  const rowCount = rowCountFor(itemCount, columns);

  const heightsRef = useRef<number[]>([]);
  if (heightsRef.current.length !== rowCount) {
    const next = new Array<number>(rowCount).fill(ESTIMATE_ROW_HEIGHT);
    const carry = Math.min(rowCount, heightsRef.current.length);
    for (let i = 0; i < carry; i++) next[i] = heightsRef.current[i];
    heightsRef.current = next;
  }

  const observersRef = useRef<Map<number, ResizeObserver>>(new Map());

  const measureListTop = useCallback(() => {
    const el = containerRef.current;
    if (el) setListTop(el.getBoundingClientRect().top + window.scrollY);
  }, []);

  useEffect(() => {
    const update = () => {
      setColumns(columnsForWidth(window.innerWidth));
      setViewportH(window.innerHeight);
      measureListTop();
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [measureListTop]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollY(window.scrollY);
        measureListTop();
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [measureListTop]);

  useEffect(() => {
    measureListTop();
  }, [columns, itemCount, version, measureListTop]);

  useEffect(() => {
    const observers = observersRef.current;
    return () => {
      observers.forEach((o) => o.disconnect());
      observers.clear();
    };
  }, []);

  const prefix = useMemo(
    () => prefixOffsets(heightsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowCount, version],
  );
  const totalHeight = prefix[prefix.length - 1] ?? 0;

  const [startRow, endRow] = useMemo(
    () => visibleRowRange(prefix, scrollY - listTop, viewportH, OVERSCAN_PX),
    [prefix, scrollY, listTop, viewportH],
  );

  const makeMeasureRef = useCallback(
    (rowIndex: number) => (el: HTMLElement | null) => {
      const observers = observersRef.current;
      const existing = observers.get(rowIndex);
      if (existing) {
        existing.disconnect();
        observers.delete(rowIndex);
      }
      if (!el) return;
      const measure = () => {
        const h = el.getBoundingClientRect().height;
        if (h > 0 && Math.abs((heightsRef.current[rowIndex] ?? 0) - h) > 0.5) {
          heightsRef.current[rowIndex] = h;
          setVersion((v) => v + 1);
        }
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.set(rowIndex, ro);
    },
    [],
  );

  const virtualRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = [];
    for (let i = startRow; i < endRow; i++) {
      rows.push({ rowIndex: i, start: prefix[i], measureRef: makeMeasureRef(i) });
    }
    return rows;
  }, [startRow, endRow, prefix, makeMeasureRef]);

  return { containerRef, columns, rowCount, totalHeight, virtualRows };
}
```

- [ ] **Step 2: Typecheck** — `./node_modules/.bin/tsc --noEmit` (exit 0). `./node_modules/.bin/eslint src/components/use-window-virtual-grid.ts` (no new errors).

- [ ] **Step 3: Commit** — `feat(virtual): window virtualization hook for the card grid`

---

### Task 3: Virtualize the dashboard grid

**Files:**
- Modify: `src/components/dashboard.tsx`

Context: today the grid is rendered at the `filtered.length === 0 ? (empty) : (<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((link, i) => <div className="animate-card-enter" style={{animationDelay, contentVisibility:"auto", containIntrinsicSize:"auto 420px"}}>...card...</div>)}</div>)` block. Replace the non-empty branch with virtualized rows. Keep the empty-state branch unchanged. Keep the inner card rendering (select overlay + `pointer-events-none` wrapper, else plain `<LinkCard>`).

- [ ] **Step 1: Add imports** (top of file, with existing imports)

```tsx
import { useWindowVirtualGrid } from "@/components/use-window-virtual-grid";
```

- [ ] **Step 2: Call the hook** — directly after the `hasActiveFilters` computation and before `return (`:

```tsx
  const { containerRef, columns, totalHeight, virtualRows } =
    useWindowVirtualGrid(filtered.length);
```

- [ ] **Step 3: Replace the non-empty grid branch.** Replace the existing `) : (` … `<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"> … </div>` … block (the cards grid) with:

```tsx
      ) : (
        <div
          ref={containerRef}
          className="relative"
          style={{ height: totalHeight }}
        >
          {virtualRows.map((vr) => {
            const startItem = vr.rowIndex * columns;
            const rowLinks = filtered.slice(startItem, startItem + columns);
            return (
              <div
                key={vr.rowIndex}
                ref={vr.measureRef}
                className="grid gap-5 absolute inset-x-0 pb-5"
                style={{
                  top: vr.start,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {rowLinks.map((link) => {
                  const selected = selectedIds.has(link.id);
                  return (
                    <div key={link.id}>
                      {selectMode ? (
                        <div
                          onClick={() => toggleSelected(link.id)}
                          className={`relative cursor-pointer rounded-xl transition-shadow ${
                            selected ? "ring-2 ring-coral" : "ring-1 ring-transparent"
                          }`}
                        >
                          <div className="absolute top-3 left-3 z-10">
                            <div
                              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                                selected
                                  ? "bg-coral border-coral text-coral-foreground"
                                  : "bg-black/40 border-white/70"
                              }`}
                            >
                              {selected && (
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  className="w-3.5 h-3.5"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                          </div>
                          <div className="pointer-events-none">
                            <LinkCard link={link} canReview={true} tandoorUrl={tandoorUrl} />
                          </div>
                        </div>
                      ) : (
                        <LinkCard link={link} canReview={true} tandoorUrl={tandoorUrl} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
```

This removes the per-card `animate-card-enter` / `contentVisibility` / `containIntrinsicSize` wrapper (virtualization supersedes it and the entrance animation would replay on every scroll-in). The `i` index var is no longer used in the grid.

- [ ] **Step 4: Typecheck + lint + tests** — `./node_modules/.bin/tsc --noEmit` (0). `./node_modules/.bin/eslint src/components/dashboard.tsx` (no NEW errors; pre-existing `currentUserId`/`FilterChip T` warnings allowed). `XDG_CACHE_HOME=/tmp/prisma-cache ./node_modules/.bin/vitest run` (33 passing).

- [ ] **Step 5: Commit** — `perf(dashboard): virtualize the card grid against window scroll`

---

### Task 4: Portal the floating select bar to `document.body`

**Files:**
- Modify: `src/components/dashboard.tsx`

Root cause being fixed: `.animate-slide-up` (the Dashboard wrapper in `src/app/page.tsx`) keeps `transform: translateY(0)` (animation `fill-mode: both`), which establishes a containing block, so the bar's `position: fixed` anchors to that tall wrapper instead of the viewport. A portal to `document.body` escapes it.

- [ ] **Step 1: Add import**

```tsx
import { createPortal } from "react-dom";
```

- [ ] **Step 2: Wrap the floating bar in a portal.** The bar block is the last child before the component's closing `</div>` — currently:

```tsx
      {selectMode && !collectionMode && (selectedIds.size > 0 || shareUrl || createError) && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
          {/* …bar contents… */}
        </div>
      )}
```

Change only the wrapper to a portal (leave the entire inner `<div className="fixed …"> … </div>` markup byte-for-byte identical):

```tsx
      {selectMode && !collectionMode && (selectedIds.size > 0 || shareUrl || createError) &&
        createPortal(
          <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
            {/* …bar contents unchanged… */}
          </div>,
          document.body,
        )}
```

`document` is safe: the block only renders when `selectMode` is true, which can only happen client-side after a user click (it is `false` during SSR), so `document.body` always exists when this runs.

- [ ] **Step 3: Typecheck + lint + tests** — `tsc --noEmit` (0), `eslint src/components/dashboard.tsx` (no new errors), `vitest run` (33 passing).

- [ ] **Step 4: Commit** — `fix(dashboard): portal floating select bar so it floats while scrolling`

---

### Task 5: Manual verification (dev server)

**Files:** none (verification only).

- [ ] **Step 1:** Start dev server: `XDG_CACHE_HOME=/tmp/prisma-cache ./node_modules/.bin/next dev` (background). Log in, load the dashboard with many recipes.
- [ ] **Step 2:** Confirm only a window of cards exists in the DOM (inspect: row count in the grid container ≪ total), and that scrolling reveals later cards smoothly with a correct-length scrollbar (no large blank gaps, no overlap).
- [ ] **Step 3:** Resize across 640px and 1024px breakpoints → columns change to 1/2/3 and layout stays correct.
- [ ] **Step 4:** Enter select mode, scroll, select recipes across different scroll positions → selection persists; the "N selected / Create 24h link" bar floats fixed at the bottom of the viewport while scrolling (not at page end). Generate + copy a link.
- [ ] **Step 5:** Open a collection link `/?c=<token>` → only the collection's recipes show, virtualized, no floating bar, banner present.
- [ ] **Step 6:** Report findings. If the dev server / login can't be exercised in this env, say so explicitly and fall back to `next build` for a compile-level check.

---

## Self-Review

- **Spec coverage:** floating bar → Task 4 (portal); lazy/virtualized loading → Tasks 1–3 (helpers, hook, integration); verification → Task 5. Covered.
- **Type consistency:** `useWindowVirtualGrid(itemCount: number)` returns `{ containerRef, columns, totalHeight, virtualRows }`; `VirtualRow` = `{ rowIndex, start, measureRef }`. Task 3 consumes exactly those names. `containerRef` typed `RefObject<HTMLDivElement | null>` matches `<div ref={containerRef}>`.
- **No placeholders:** all code blocks complete; the only elision is the bar's inner markup in Task 4, explicitly "unchanged".
- **Env:** no new dependency; all commands use `./node_modules/.bin/*` with `XDG_CACHE_HOME=/tmp/prisma-cache`.
