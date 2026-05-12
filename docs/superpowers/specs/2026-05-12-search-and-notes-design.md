# Search & Notes Auto-Population Design

## Summary

Two related features:
1. Client-side text search in the dashboard over `notes`, `url`, and `reviewNote`
2. Auto-populate `Link.notes` from scraped media description — system-owned, never user-entered

## Field Semantics (after this change)

| Field | Owner | When set |
|---|---|---|
| `notes` | System | After media resolution — Instagram caption or OG description |
| `reviewNote` | User | At rating time in the swipe UI |

`notes` is **removed from the submit form**. The submit schema (`submitLinkSchema`) drops the `notes` field entirely. No DB migration — field stays nullable, just no longer user-writable.

## 1. Search

### Where
Text input added to the dashboard filter bar in `src/components/dashboard.tsx`, alongside existing rating/category/urgency chips.

### How it works
- Client-side `useMemo` filter on the already-loaded `LinkItem[]` array
- Case-insensitive substring match across `notes`, `url`, `reviewNote`
- Composes with existing chip filters (AND logic — both search term and active chips must match)
- No new API routes or server round-trips

### UI
- Single `<input type="search">` in the filter bar
- Clears on chip reset (or independently)
- Placeholder: "Search notes, URL…"

## 2. Notes Auto-Population

### On new link submission
After `scheduleMediaResolution(link.id)` completes, a new step runs to populate `notes`:

- **Instagram URLs** (`isInstagramUrl(url)`): call `scrapeSocialMediaPost(url)` → store `result.description` as `Link.notes` (truncated to 500 chars)
- **Non-Instagram URLs**: after `doResolve`, copy `MediaAsset.description` → `Link.notes`

If scraping fails or returns empty, `notes` stays null — no error, best-effort.

Implementation: extend `doResolve` in `src/lib/media-store.ts` to also update `Link.notes` when a description is obtained. For Instagram, `scrapeSocialMediaPost` is called after snapsave media download.

### Backfill script (`scripts/backfill-notes.ts`)
Standalone script, run once via `npx tsx scripts/backfill-notes.ts`.

Steps:
1. Fetch all Links where `notes` is null or empty
2. For each:
   - **Instagram**: call `scrapeSocialMediaPost(url)` → update `Link.notes`
   - **Non-Instagram with `mediaAsset.description`**: copy directly → update `Link.notes`
   - **Non-Instagram without mediaAsset**: fetch OG metadata via `extractMeta` → update `Link.notes`
3. Log per-link result (updated / skipped / failed)
4. Print final summary: X updated, Y skipped (no description available), Z failed

Requires `BROWSERLESS_API_KEY` env var for Instagram scraping. Non-Instagram links work without it.

## 3. Submit Form Changes

- Remove `notes` textarea from the add-link form UI (`src/components/submit-link-form.tsx`)
- Remove `notes` from `submitLinkSchema` in `src/lib/validations.ts`
- Remove `notes` from `submitLink` server action (`src/lib/actions.ts`)
- Remove `notes` from `POST /api/links` route (`src/app/api/links/route.ts`) — same schema, covered automatically once schema is updated

### Env requirements
- Backfill script + Instagram auto-population require `BROWSERLESS_API_KEY`
- Non-Instagram paths work without it

## Out of Scope

- Server-side search / pagination
- Search in the swipe view
- Editing `notes` via UI (it's system-owned)
