# Memory Leak Fix + Shareable Temporary Collections — Design

Date: 2026-06-12

Two independent phases in one document. Phase 1 (memory/perf) is the priority and
ships on its own. Phase 2 (shared collections) builds on the cleaned-up dashboard.

---

## Problem

1. **Severe memory leak.** A user's browser grew to ~32GB. The dashboard renders
   every recipe at once and each Instagram recipe mounts a live Instagram embed
   `<iframe>`. Each iframe is a separate browsing context loading Instagram's heavy
   embed bundle; once scrolled past they stay loaded and never unmount. Hundreds of
   them → multi-GB → the observed 32GB.
2. **Loading is heavy.** All links are fetched server-side in one query and every
   non-Instagram card fires an uncapped `/api/og` fetch on mount.
3. **Missing feature.** Users want to multi-select recipes and produce a temporary
   (24h) shareable link that, for logged-in viewers, scopes the dashboard to just
   those recipes.

## Current state (relevant files)

- `src/app/page.tsx:12` — `prisma.link.findMany` loads ALL links + `mediaAsset`.
- `src/components/dashboard.tsx:351` — renders all filtered `LinkCard`s at once.
- `src/components/link-card.tsx:450` — live Instagram `<iframe>` per card (the leak).
- `src/components/link-card.tsx:50` — `OgPreview` fires an uncapped fetch on mount.
- `src/lib/media-cache.ts` — capped (2-concurrent) media fetcher used by swipe view,
  with an unbounded `cache` Map. Reusable pattern for the dashboard.
- `src/lib/auth.ts` — next-auth v5 (JWT); `session.user.id` available in server
  components. `page.tsx`/`swipe/page.tsx` already redirect unauthenticated → `/login`.
- `prisma/schema.prisma` — `Link`, `MediaAsset`, `User` models.

---

## Phase 1 — Memory leak + loading

### 1. Remove inline Instagram iframes (primary fix)

In `link-card.tsx`, replace the live embed `<iframe>` with a static thumbnail
`<img>`. Source priority: resolved `mediaAsset.thumbnailUrl` → `mediaAsset.blobUrl`
→ OG image. Clicking the thumbnail keeps existing behavior (open `InstagramModal`
on desktop, new tab on mobile). No persistent iframes remain anywhere in the list.

### 2. Bound offscreen rendering cost (layered, lowest-risk first)

- `loading="lazy"` + `decoding="async"` + explicit width/height (or aspect-ratio)
  on every card `<img>`. Stops offscreen images from fetching/decoding.
- `content-visibility: auto` + `contain-intrinsic-size` on the card wrapper in
  `dashboard.tsx`. Browser skips layout/paint of offscreen cards natively, no JS.
- **Escalation (only if profiling still shows unbounded growth):**
  `IntersectionObserver`-based mount/unmount — render lightweight placeholders and
  mount the heavy `LinkCard` body only when near the viewport, unmount when far.
  Placeholder keeps `contain-intrinsic-size` so scroll position is stable.

Rationale: with iframes gone and images lazy, the remaining offscreen cost is small;
`content-visibility` handles paint/layout cheaply. Full virtualization is held in
reserve to avoid scroll-jank complexity unless measurements demand it.

### 3. Cap OG fetches + bound the cache

- Route `OgPreview` fetches through the `media-cache.ts` capped fetcher (max 2
  concurrent) instead of firing one fetch per card on mount.
- Add an LRU bound to the `cache` Map (e.g. 200 entries) so it can't grow without
  limit during a long session.

### 4. Trim server payload

`page.tsx` query selects only fields the card actually renders (drop unused columns),
keeps the `mediaAsset` relation. List stays fully client-filterable via the existing
search/filter; windowing (step 2) bounds what is live in the DOM.

### Phase 1 success criteria

- No Instagram `<iframe>` mounted in the dashboard list at any time.
- Scrolling the full list does not grow tab memory unbounded (flat after GC).
- At most ~2 in-flight OG/media fetches at once.
- Existing rate / categorize / Tandoor / modal behaviors unchanged.

---

## Phase 2 — Shareable temporary collections

### Data model (`prisma/schema.prisma`)

```prisma
model SharedCollection {
  id          String   @id @default(cuid()) // the share token
  linkIds     String[]                        // snapshot of selected Link ids
  createdBy   User     @relation(fields: [createdById], references: [id])
  createdById String
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@index([expiresAt])
}
```

Snapshot of IDs (Postgres `String[]`), no join table — the set is fixed at creation.
`User` gains a `sharedCollections SharedCollection[]` back-relation. New migration.

### Create flow

- `dashboard.tsx` gains a "Select" toggle. In select mode each card shows a checkbox;
  a floating action bar shows the selected count and a "Create link" button.
- A server action (`src/lib/actions.ts`) takes the selected link IDs, writes a
  `SharedCollection` with `expiresAt = now + 24h`, returns the token.
- UI shows the resulting URL `/?c=<token>` with a copy button.
- Validation (zod): non-empty ID list, all IDs exist, cap on count.

### View flow

- `page.tsx` reads `searchParams.c`.
- If token present, valid, and `expiresAt > now`: query
  `where: { id: { in: collection.linkIds } }` and render the dashboard in
  **collection mode** — filter bar hidden, a banner shows
  "Shared collection · N recipes · expires in Xh" plus a "View all recipes" link
  (`/`) to escape. Full rate/edit interaction is preserved.
- If token missing/invalid/expired: render the normal full dashboard; if a `c` param
  was supplied but invalid/expired, also show an inline "This link has expired" notice.
- **Lazy expiry + cleanup:** expiry is enforced by the `expiresAt > now` check on read
  (no cron). Best-effort: opportunistically delete rows where `expiresAt < now` during
  the same request path.

### Auth

No new auth code. `page.tsx` already redirects unauthenticated users to `/login`, so
collection links are login-gated for free.

### Phase 2 success criteria

- Logged-in user can multi-select recipes and get a `/?c=<token>` URL.
- Opening a valid link shows exactly the selected recipes in collection mode.
- After 24h the same link shows the expired notice and the full dashboard.
- Unauthenticated visitor to a collection link is sent to `/login` first.

---

## Out of scope

- Editing an existing collection's recipe set after creation.
- Per-viewer filtering within a shared collection (fixed view by decision).
- A scheduled/cron purge job (lazy + opportunistic cleanup only).
- Public (non-logged-in) sharing.

## Testing

- Unit: collection create server action (validation, expiry math); `media-cache`
  LRU eviction; expired-vs-valid token resolution.
- Manual: load full dashboard, scroll, confirm flat memory in DevTools; create a
  link, open in a second session, verify scoped set + full interaction; fast-forward
  `expiresAt` (or short TTL) to confirm expiry behavior.
