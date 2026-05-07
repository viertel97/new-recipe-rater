# Mobile Swipe v2 — Design

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Scope:** Single cohesive spec covering PWA install, mobile-first polish, swipe filters, swipe-engine bug fixes, and persistent media store. Ships in 5 independently-deployable phases.

---

## 1. Problem

Users report:

1. **No installable app.** Recipe Rater runs in the browser only. No "Add to Home Screen" experience, no app-like chrome.
2. **Mobile experience feels rough.** Touch targets, sheet patterns, scroll behaviour, and keyboard handling are not tuned for daily phone use.
3. **No filters during swipe.** All `PENDING` links go into one queue. Users can't focus a session on, e.g., dinner ideas only.
4. **Visible "reload" jank between cards.** Each swipe makes the next card visibly shift / re-mount, and any video on the next card resets.
5. **Some videos never load.** Instagram CDN URLs are signed and expire; cached snapsave responses go stale within ~1 hour.

## 2. Goals

- App-like experience on iOS Safari and Android Chrome via PWA shell (manifest + service worker + offline shell).
- Smooth swipe loop: zero visible "Loading..." flash on the visible queue, no card jump after rating, no video reset on the freshly-active card.
- Persistent video/image storage for pending links so playback is reliable and doesn't depend on Instagram's signed URLs.
- Per-category filtering of the swipe queue via a top-bar bottom sheet.
- Polished daily-use surfaces: dashboard `/` and add-link `/add`.

## 3. Non-goals

- Offline rate-then-sync. Rating requires connectivity. (Discussed and dropped — adds DB-merge complexity, two-user app doesn't need it.)
- Push notifications.
- Re-swiping rated links from inside `/swipe`. Re-rate stays on the dashboard via the existing reset action.
- Multi-user scaling, analytics/telemetry, CDN distribution. Local disk + browser cache is sufficient.
- Video transcoding. Serve mp4 as-is.

## 4. Root-cause analysis of the swipe jank

The visible bug has two reinforcing causes.

### 4.1 Server-action revalidation races the optimistic index advance

`rateLink` in `src/lib/actions.ts` calls `revalidatePath("/")`. In Next.js 16, a server action invoked from a client component triggers a router refresh of the **current** route, so `/swipe` re-fetches its RSC payload. The fresh `links` prop arrives after `useState(index)` has already advanced.

Concrete walkthrough — `links = [A, B, C, D]`, `index = 0`:

1. User swipes `A` right. `handleSwipe` calls `advance()` which sets `index = 1`. React renders. Stack: `B (active), C (back)`.
2. Server action completes; revalidation arrives. `links` is now `[B, C, D]`. `index` still `1`. Stack: `C (active), D (back)`.
3. **`B` unmounts. `C` jumps from back-slot to active-slot. `D` mounts fresh.**

That visible jump is symptom **D** ("card stack visibly re-renders"). The video reset (symptom **C**) follows because `D` mounts fresh, fires `useMediaData`, and shows "Loading..." until the new video URL resolves.

### 4.2 Per-card client-side media fetch with no shared cache

`useMediaData` in `src/components/swipe-card.tsx` runs on every mount. There is no shared cache, so freshly-mounted back cards always begin in `{ type: "loading" }`. The preload in `src/components/swipe-view.tsx:27-36` only warms the HTTP cache; it does not deliver parsed data into the new component.

### 4.3 Expired Instagram CDN URLs

Even when snapsave responses are cached at the HTTP layer, the inner `mp4` URL is short-lived and signed. After ~1 hour it returns 403/404 and the `<video>` element fails silently. This is the "videos don't load at all" symptom.

## 5. Architecture overview

Cross-cutting design decisions:

- **Stable swipe queue.** The client owns "what to render next" via a snapshot of `initialLinks` plus a local `ratedIds` set. After mount, `useSwipeQueue` ignores prop updates of `initialLinks`, so server revalidation never mutates the active visible queue.
- **Persistent media store, scoped to PENDING.** A new Prisma model `MediaAsset` plus on-disk storage under `./data/media/` give pending links durable, locally-served media. Rated links (GOOD/BAD) evict their stored media on transition; the dashboard lazy-loads them via the existing `/api/instagram` and `/api/og` routes when viewed.
- **Server-resolved media for the visible queue.** `/swipe` (server component) resolves media for the first 5 pending links in `MediaStatus = RESOLVED` and ships the records to the client. The remainder is lazy-fetched client-side via a shared `MediaCache` with concurrency limit 2.
- **PWA shell.** Manifest, icons, theme metadata in the root layout; hand-rolled service worker at `public/sw.js` providing precache + runtime caching strategies. No `next-pwa` dependency.
- **Filter sheet.** Bottom sheet toggled from the swipe top bar, persisted to `localStorage`, applied at the queue level on the client.
- **Mobile polish.** Surface-by-surface fixes for `/` and `/add`, plus a shared `<BottomSheet>` primitive extracted from the existing urgency sheet.

### 5.1 Component boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/swipe-queue.ts` (new, client) | `useSwipeQueue` hook: snapshot, filter, advance, rate | `lib/actions.ts`, `MediaCache` |
| `lib/media-cache.ts` (new, client) | `MediaCache.get(linkId)` / `.warm(link)` with concurrency limiter | `fetch /api/media/[id]` |
| `lib/media-store.ts` (new, server) | `resolveMediaForLink(link)` — snapsave/OG → download → DB row | `prisma`, `snapsave`, `lib/og.ts` |
| `lib/media-resolver.ts` (new, server) | Background queue with global concurrency 3, used by `submitLink` and `/swipe` page | `media-store` |
| `app/api/media/[id]/route.ts` (new) | Streams the file, long-cache headers | `prisma`, fs |
| `components/swipe-view.tsx` (refactor) | Orchestration, top bar, bottom buttons | `useSwipeQueue` |
| `components/swipe-card.tsx` (refactor) | Receives `media: MediaAsset \| null`, only fetches if null | `MediaCache` |
| `components/swipe-filter-sheet.tsx` (new) | Category filter bottom sheet | `<BottomSheet>` |
| `components/ui/bottom-sheet.tsx` (new) | Shared sheet primitive extracted from `urgency-sheet.tsx` | — |
| `components/sw-register.tsx` (new) | Registers service worker on mount | — |
| `components/install-prompt.tsx` (new) | `beforeinstallprompt` UI on dashboard | — |

Each unit is independently testable. `useSwipeQueue` is pure logic over input arrays. `lib/media-store.ts` is server-only, mockable via `fetch`/`snapsave` stubs.

## 6. Phase 1 — Swipe engine fix

### 6.1 New: `lib/swipe-queue.ts`

```ts
type Filters = {
  categories: Category[] | null
  includeUncategorized: boolean
}

export function useSwipeQueue(
  initialLinks: LinkItem[],
  filters: Filters,
): {
  active: LinkItem | null
  next: LinkItem | null
  remaining: number
  stats: { liked: number; noped: number }
  rate: (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => void
}
```

- Snapshots `initialLinks` once into local state on first mount. Subsequent `initialLinks` prop updates (e.g. from server revalidation) are **ignored** for the duration of the session. A new session starts on full unmount or on user-triggered "refresh" (out of scope here).
- Maintains `ratedIds: Set<string>`.
- Derives the visible queue: `snapshot.filter(l => !ratedIds.has(l.id) && matchesFilter(l, filters))`. `active = visible[0]`, `next = visible[1]`.
- `rate(id, rating, opts)` adds `id` to `ratedIds` synchronously, then fires `rateLink` server action inside `startTransition`.
- Side-effect on `next?.id` change: fires `MediaCache.warm(next)` so the back card's media is ready before promotion.

### 6.2 `swipe-view.tsx` refactor

- Replace `index` / `setIndex` / scattered preload `useEffect` with `useSwipeQueue`.
- Render exactly two cards: `active` and `next`. Same `<SwipeCard key={link.id} ... />` pattern; React keeps both mounted across rate transitions because keys remain stable until the link leaves the visible window.
- Empty / completion states unchanged in design but fed from `remaining === 0`.

### 6.3 `swipe-card.tsx` refactor

- New prop `media: MediaAsset | null`. If non-null, render the `<video>` / `<img>` directly from `/api/media/${media.id}` with the appropriate `contentType`.
- If null, fall back to the current client-side fetch path via `MediaCache` (used for non-pending links and Phase-1-without-Phase-2 deploys).
- Bug fix at `swipe-card.tsx:179` — `videoRef.current.muted = !muted` reads stale `muted`. Move to a `useEffect` keyed on `muted` that syncs the imperative property:
  ```ts
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])
  ```

### 6.4 `lib/media-cache.ts`

```ts
export const MediaCache: {
  get(linkId: string): Promise<MediaAsset | null>
  warm(link: LinkItem): void
}
```

- In-memory `Map<linkId, Promise<MediaAsset | null>>`.
- Concurrency limited to 2 in-flight fetches via a small queue.
- On 404 from `/api/media/[id]` → returns `null`, card falls back to favicon view.

### 6.5 Server-action behaviour

`rateLink` keeps `revalidatePath("/")`. The dashboard still wants fresh data. The hook's prop-ignore strategy makes this safe for `/swipe`. **No tag-scoped revalidation needed.** This is simpler than the alternative.

### 6.6 Acceptance — Phase 1

- Swipe right: urgency sheet opens immediately. Server-action latency does not visibly affect the card stack.
- Swipe a sequence of 10 cards: no "Loading..." flash on the visible queue head after card #1 (covered by Phase 2's pre-resolved media; pre-Phase-2, the cache warming covers the typical case but the flash may still appear on cold first-fetches).
- Video on the next card already plays when promoted to active — no reset.
- Mid-session server revalidation does not reorder visible cards.
- Manual smoke test: 20-card swipe-through on iOS Safari + Chrome Android.

## 7. Phase 2 — Persistent media store (PENDING-only)

### 7.1 Prisma schema

```prisma
model MediaAsset {
  id            String      @id @default(cuid())
  sourceUrl     String      @unique
  type          MediaType
  localPath     String      // relative to MEDIA_ROOT, e.g. "ab/cd/abcd1234.mp4"
  contentType   String      // "video/mp4", "image/jpeg"
  sizeBytes     Int
  thumbnailPath String?     // poster frame for videos (jpeg)
  title         String?
  description   String?
  fetchedAt     DateTime    @default(now())
  link          Link?
}

enum MediaType { VIDEO IMAGE }

model Link {
  // existing fields ...
  mediaAssetId  String?     @unique
  mediaAsset    MediaAsset? @relation(fields: [mediaAssetId], references: [id])
  mediaStatus   MediaStatus @default(PENDING)
  mediaError    String?
}

enum MediaStatus { PENDING RESOLVED FAILED EVICTED }
```

`Link.mediaAssetId` is `@unique` because the relation is 1:1 in practice. Cross-link reuse of identical source URLs is prevented at submit time by the existing duplicate-URL check.

### 7.2 `lib/media-store.ts`

```ts
export async function resolveMediaForLink(link: Link): Promise<MediaAsset | null>
```

Behaviour:

1. Guard: if `link.rating !== "PENDING"`, return `null` and do not resolve. The store is scoped to pending only.
2. If `link.mediaAssetId` is set and the row + file exist → return the row.
3. Acquire a per-`sourceUrl` mutex (process-local `Map<url, Promise>`). Concurrent calls for the same URL share the same in-flight resolve.
4. Dispatch by URL pattern:
   - Instagram (`instagram.com/(p|reel|reels|tv)/...`) → `snapsave(url)` to obtain media list.
   - Otherwise → existing OG scraper from `lib/og.ts`.
5. Choose the primary media (first video, else first image).
6. Stream the binary via `fetch` with a 30s timeout, write to `${MEDIA_ROOT}/${shard}/${id}.${ext}`. `shard` is the first 4 hex chars of `id` split as `ab/cd`. `ext` is derived from `contentType` (`video/mp4` → `mp4`, `image/jpeg` → `jpg`, etc.). Total path example: `data/media/ab/cd/abcd1234.mp4`. `MEDIA_ROOT` defaults to `./data/media`, overrideable via env.
7. Insert `MediaAsset` row, attach `link.mediaAssetId`, set `mediaStatus = RESOLVED`.
8. On any failure: set `mediaStatus = FAILED`, `mediaError = <reason>`. Do not throw to caller.

### 7.3 `lib/media-resolver.ts`

Background queue with global concurrency 3. Triggered:

- `submitLink` (fire-and-forget after the row is created).
- `/swipe` page render — for any pending link with `mediaStatus = PENDING`, enqueue resolution. The page does **not** await these; it ships the page with whatever `RESOLVED` rows exist.
- Manual: `POST /api/admin/resolve-media` (auth-gated) to backfill on demand.

### 7.4 `/api/media/[id]/route.ts`

- Validate `id` against `MediaAsset` table. If missing, 404.
- Stream file from disk via `fs.createReadStream`. Set `Content-Type` from row, `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges: bytes` for video seeking.
- If file is missing on disk but row exists (crash mid-write): mark `mediaStatus = FAILED`, return 404. Background resolver will retry on next page load.

### 7.5 Eviction on rate

Modify `rateLink` action: after the rating update, if the link had a `mediaAssetId`:

1. Read the `MediaAsset` row.
2. `fs.unlink` the file (and thumbnail if any). Best-effort; log on failure.
3. Delete the `MediaAsset` row.
4. Set `link.mediaAssetId = null`, `link.mediaStatus = EVICTED`.

The dashboard lazy-loads media for rated links via the existing `/api/instagram` and `/api/og` endpoints. Those routes stay in the codebase indefinitely.

### 7.6 Backfill

`scripts/backfill-media.ts` iterates `Link` where `rating = PENDING AND mediaStatus = PENDING` and calls `resolveMediaForLink` with concurrency 2. Idempotent — safe to re-run.

### 7.7 Storage hygiene

- `.gitignore` and `.dockerignore` add `data/`.
- `docker-compose.yml` adds a named volume mounted at `/app/data` for the application container.
- `next.config.ts` is unaffected — `data/` is outside `public/`.
- Defensive sweep `scripts/cleanup-orphan-media.ts`: lists files on disk, cross-checks against `MediaAsset` rows, removes orphans. Run manually if disk usage drifts.

### 7.8 Acceptance — Phase 2

- Submitting a new Instagram link triggers a background resolve; within ~5–15s `mediaStatus` flips to `RESOLVED` and the file appears under `data/media/`.
- Loading `/swipe` for cards with `mediaStatus = RESOLVED` shows zero `/api/instagram` or `/api/og` traffic — only `/api/media/[id]` requests.
- After rating a card, the file is deleted from disk and the row is gone.
- Failed resolves render the favicon-fallback variant of `SwipeCard` and remain swipeable.
- Storage stays bounded at roughly the size of the pending queue.

## 8. Phase 3 — PWA shell

### 8.1 Manifest

`public/manifest.webmanifest`:

```json
{
  "name": "Recipe Rater",
  "short_name": "Recipes",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "share_target": {
    "action": "/add",
    "method": "GET",
    "params": { "url": "url", "title": "title", "text": "text" }
  }
}
```

### 8.2 Icons

`public/icons/` contains 192×192, 512×512, and a maskable 512×512 variant. Generated from `src/app/icon.png` via `scripts/gen-icons.ts` (sharp). One-shot generation; check generated PNGs into git.

### 8.3 Root layout updates

`src/app/layout.tsx` adds inside `<head>` (via Next metadata API where supported, raw `<link>` otherwise):

- `<link rel="manifest" href="/manifest.webmanifest" />`
- `<meta name="theme-color" content="#0a0a0a" />`
- `<link rel="apple-touch-icon" href="/icons/icon-192.png" />`
- `<meta name="apple-mobile-web-app-capable" content="yes" />`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`

`<SwRegister />` mounted at the bottom of the body.

### 8.4 Service worker

`public/sw.js`, hand-rolled (~100 lines, no Workbox to avoid Next-version skew):

```js
const SW_VERSION = "v1"  // bump on every PR that touches SW
const PRECACHE = `precache-${SW_VERSION}`
const RUNTIME = `runtime-${SW_VERSION}`

const PRECACHE_URLS = [
  "/", "/swipe", "/login", "/add", "/offline",
  "/manifest.webmanifest",
  // CSS + fonts hashed by Next — handled via runtime cache instead
]
```

Strategies:

| Request match | Strategy | Notes |
|---|---|---|
| `/api/media/*` | Cache-first | Approximate LRU: on `activate`, if `RUNTIME` cache exceeds 200 entries, oldest are deleted by insertion order |
| `/_next/static/*` | Cache-first | Hashed filenames, safe forever |
| Navigation requests | Network-first | Fallback `/offline` |
| Other GET | Network-first | Fallback cache |
| Non-GET | Pass-through | Never cached |

`activate` event purges caches not matching current `SW_VERSION`.

### 8.5 Offline page

`src/app/offline/page.tsx` — minimal "you're offline" with a "Retry" button that reloads. Static, precached.

### 8.6 Service worker registration

`src/components/sw-register.tsx`:

```tsx
"use client"
useEffect(() => {
  if (process.env.NODE_ENV !== "production") return
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(console.error)
  }
}, [])
```

Bypassed in dev to avoid stale-cache pain during development.

### 8.7 Install prompt

`src/components/install-prompt.tsx` listens for `beforeinstallprompt`, stashes the event, renders a small banner on the dashboard with "Install" + "Not now". Dismissed state stored in `localStorage.installPrompt.dismissedAt`. Re-shows after 30 days.

### 8.8 Headers

`next.config.ts`:

```ts
async headers() {
  return [
    { source: "/sw.js", headers: [
      { key: "Service-Worker-Allowed", value: "/" },
      { key: "Cache-Control", value: "no-cache" },
    ] },
  ]
}
```

### 8.9 Acceptance — Phase 3

- Chrome desktop devtools shows installable prompt for the dashboard.
- iOS Safari Share → "Add to Home Screen" → opens fullscreen with no browser chrome.
- After first online visit, airplane mode + reopen → app shell renders, swipe page shows cached cards with cached media (videos via `/api/media/*`).
- Lighthouse PWA score ≥ 90.
- Sharing an Instagram URL via the system share sheet → "Recipes" appears as a target → opens `/add?url=...` prefilled.

## 9. Phase 4 — Category filter

### 9.1 UI

Top bar in `swipe-view.tsx` adds a filter button next to the counter. Funnel icon, badge with count when filters are active.

Tap → `<SwipeFilterSheet />` slides up from the bottom using the new `<BottomSheet>` primitive (extracted from `urgency-sheet.tsx`).

Sheet body:

- 4 toggleable category chips: Dinner, Snack, Cake, Breakfast.
- 1 toggleable "Uncategorized" chip (independent).
- Footer: "Apply" + "Reset".

Selecting nothing equals "no filter" (show all).

### 9.2 State

`useSwipeFilters()` hook reads/writes `localStorage.swipe.filters`:

```ts
{
  categories: Category[]   // [] means "no category constraint"
  includeUncategorized: boolean
}
```

Default: `{ categories: [], includeUncategorized: true }` (show everything).

### 9.3 Behaviour

- Filters are passed into `useSwipeQueue(initialLinks, filters)`.
- Match function:
  ```ts
  function matchesFilter(link: LinkItem, f: Filters): boolean {
    const noConstraint = f.categories.length === 0 && f.includeUncategorized
    if (noConstraint) return true
    if (link.category == null) return f.includeUncategorized
    return f.categories.includes(link.category)
  }
  ```
- Applying a new filter recomputes the visible queue. `ratedIds` is preserved.
- If the active card no longer matches the new filter, it disappears from view (does **not** get rated).
- Empty filtered queue: render an empty state with "Clear filters" CTA inline.

### 9.4 Acceptance — Phase 4

- Open sheet, pick "Dinner", apply → only dinner cards visible.
- Filters persist across reload.
- Reset clears all filters.
- Funnel icon shows badge with active filter count.

## 10. Phase 5 — Mobile polish (`/` and `/add`)

### 10.1 Dashboard `/`

- Sticky filter bar with backdrop blur (mirrors swipe top-bar pattern).
- Audit touch targets — all interactive elements ≥ 44 pt.
- Action menus → bottom sheets on mobile (reuse `<BottomSheet>`).
- Replace any `vh` with `dvh` repo-wide. iOS toolbar collapse no longer cuts content.
- Skeleton loaders for OG previews — currently nothing during load causes layout shift.
- Empty / loading states consistent with swipe (emoji + helper + CTA).
- Safe-area insets respected on bottom nav and any FABs.
- Pull-to-refresh: rely on browser default in non-standalone; if standalone PWA disables it noticeably, defer rather than build a custom PTR.

### 10.2 Add page `/add`

- Read `?url=` query param on render; prefill input. (Drives the manifest share-target.)
- Paste detection on input focus: read clipboard with permission, show "Paste \"<url>\"?" chip. No blocking permission prompt; gracefully degrade.
- Input attributes: `inputMode="url"`, `enterKeyHint="done"`, `autoCapitalize="off"`, `spellCheck={false}`.
- Submit button sticky to viewport bottom: `position: sticky; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`. Above the keyboard via `interactive-widget=resizes-content` viewport hint.
- Notes textarea uses `field-sizing: content` for auto-grow. Fallback: fixed 4-row.
- Optimistic local feedback on submit. Inline duplicate-link error (already returned by `submitLink`, currently surfaced as toast only — also render inline).
- "Add another" toggle: on submit, stay on `/add` with input cleared instead of navigating back.

### 10.3 Cross-cutting

- Haptic feedback on swipe complete + filter apply via `navigator.vibrate(10)`. Cheap, no-op on iOS PWA.
- Optional: Next 16 view transitions for `/` ↔ `/swipe` ↔ `/add`. Use only if stable in this Next version; otherwise skip.

### 10.4 Acceptance — Phase 5

- Dashboard scroll smooth at 60 fps on a 4× CPU-throttled DevTools profile.
- `/add`: focus input → keyboard appears → submit button visible → submit succeeds without scroll glitches.
- Share from Instagram app → "Recipes" → `/add` prefilled with URL → one-tap submit.
- All bottom UI clears the iOS home indicator.

## 11. Testing

The project has no tests today. Add `vitest` + `@testing-library/react` to devDeps. `npm test` script.

In-scope tests:

- `lib/swipe-queue.test.ts` — pure logic over input arrays:
  - Snapshot stability when `initialLinks` prop changes.
  - Filter combinations (categories only, uncategorized only, both, neither).
  - `rate()` advances the visible queue correctly.
  - Empty filtered queue.
- `lib/media-store.test.ts` — mocked `fetch` and `snapsave`:
  - Concurrent calls for the same `sourceUrl` share one in-flight resolve.
  - Failure path marks `mediaStatus = FAILED` without throwing.
  - Sharded path generation is deterministic.

Out of scope: Playwright SW/gesture integration tests. Cost not justified at this scale. Manual QA checklist per phase covers iOS Safari install, Android Chrome install, offline behaviour, share-target, and a 20-card swipe sequence.

## 12. Observability

- `lib/media-store.ts` logs `[media-store] resolved sourceUrl=… type=… size=… ms=…` on success and `[media-store] failed sourceUrl=… reason=…` on failure.
- Service worker and swipe errors → `console.error` with `[sw]` / `[swipe]` prefixes. No external error reporter.
- `GET /api/admin/media-health` (auth-gated) returns counts grouped by `mediaStatus`, total bytes on disk, oldest pending. Spot-check after deploys.

## 13. Rollout plan

Each phase ships independently; order matters because Phase 2 strengthens Phase 1's acceptance (zero loading flash) and Phase 3 benefits from media being permanent.

1. **Phase 1 — swipe engine fix.** Pure refactor, no schema change. One PR. Manual swipe-of-10 smoke test before merge.
2. **Phase 2 — media store.** Schema migration first, then backfill via `scripts/backfill-media.ts`, then verify via `media-health`, then switch `SwipeCard` to consume `mediaAsset`. Existing `/api/instagram` + `/api/og` routes stay (used by dashboard for rated links and as fallback).
3. **Phase 3 — PWA.** Manifest + SW + offline page + install prompt. Service worker behind `?sw=1` query flag for the first day post-deploy to validate; flip on unconditionally after. SW version bump ritual: any PR touching `sw.js` must increment `SW_VERSION`.
4. **Phase 4 — category filter.** Additive, low risk.
5. **Phase 5 — mobile polish.** Multiple small PRs grouped by surface (`/` dashboard, `/add`).

## 14. Open questions / explicit deferrals

- **Storage growth long-term.** Eviction-on-rate caps storage at ~queue depth. If the queue grows unbounded (rare for a two-user app), revisit with a TTL on `MediaAsset.fetchedAt` for never-rated stale links.
- **View transitions API.** Use only if Next 16 exposes a stable wrapper. Otherwise skip without blocking Phase 5.
- **Share-target on iOS.** iOS Safari support for `share_target` is partial. Acceptable: feature works on Android; iOS users still paste manually.

## 15. Acceptance summary

- No visible "Loading..." flash on the visible swipe queue head after first card.
- No card-stack jump after rating; no video reset on the freshly-active card.
- Instagram videos remain playable indefinitely while the link is `PENDING`.
- App is installable on iOS Safari and Android Chrome with custom icon, name, and theme.
- App shell renders offline; cached pending cards display offline. Submitting ratings still requires connectivity (no offline rate queue per non-goal).
- Category filter persists across sessions, applies to the swipe queue, never re-orders cards mid-session.
- Dashboard and add pages feel native on a phone: no layout shift, no keyboard glitches, share-target works.
