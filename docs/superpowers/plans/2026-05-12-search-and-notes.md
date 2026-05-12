# Search & Notes Auto-Population Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side text search to the dashboard and auto-populate `Link.notes` from scraped media descriptions instead of user input.

**Architecture:** Extract a pure `searchLinks` function for testability; wire it into the dashboard's existing `useMemo` filter chain; extend `doResolve` in `media-store.ts` to write notes after media resolution; provide a one-shot backfill script for existing rows.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, Vitest, Playwright (via browserless), Tailwind CSS v4

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/search-links.ts` | **Create** | Pure filter function over `LinkItem[]` |
| `src/lib/__tests__/search-links.test.ts` | **Create** | Unit tests for search function |
| `src/lib/validations.ts` | **Modify** | Remove `notes` from `submitLinkSchema` |
| `src/lib/actions.ts` | **Modify** | Remove `notes` from `submitLink` |
| `src/components/submit-link-form.tsx` | **Modify** | Remove notes textarea |
| `src/components/dashboard.tsx` | **Modify** | Add search input + wire `searchLinks` |
| `src/lib/media-store.ts` | **Modify** | Auto-populate `Link.notes` in `doResolve` |
| `scripts/backfill-notes.ts` | **Create** | One-shot backfill for existing empty notes |

---

## Task 1: Search filter pure function

**Files:**
- Create: `src/lib/search-links.ts`
- Create: `src/lib/__tests__/search-links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/search-links.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { searchLinks } from "@/lib/search-links";
import type { LinkItem } from "@/types/link";

function makeLink(partial: Partial<LinkItem> & { id: string }): LinkItem {
  return {
    url: "https://example.com",
    rating: "PENDING",
    urgency: null,
    notes: null,
    reviewNote: null,
    tandoorRecipeId: null,
    category: null,
    categoryStatus: "DONE",
    createdAt: new Date("2026-01-01"),
    submittedById: "u1",
    submittedBy: { name: "Alice", email: null },
    mediaAsset: null,
    mediaStatus: "PENDING",
    ...partial,
  };
}

describe("searchLinks", () => {
  it("returns all links for empty query", () => {
    const links = [makeLink({ id: "a" }), makeLink({ id: "b" })];
    expect(searchLinks(links, "")).toHaveLength(2);
  });

  it("returns all links for whitespace-only query", () => {
    const links = [makeLink({ id: "a" }), makeLink({ id: "b" })];
    expect(searchLinks(links, "   ")).toHaveLength(2);
  });

  it("matches url case-insensitively", () => {
    const links = [
      makeLink({ id: "a", url: "https://instagram.com/p/abc" }),
      makeLink({ id: "b", url: "https://tiktok.com/v/xyz" }),
    ];
    expect(searchLinks(links, "INSTAGRAM")).toEqual([links[0]]);
  });

  it("matches notes", () => {
    const links = [
      makeLink({ id: "a", notes: "Pasta recipe from Italy" }),
      makeLink({ id: "b", notes: "Chocolate cake" }),
    ];
    expect(searchLinks(links, "pasta")).toEqual([links[0]]);
  });

  it("matches reviewNote", () => {
    const links = [
      makeLink({ id: "a", reviewNote: "Too spicy for kids" }),
      makeLink({ id: "b", reviewNote: null }),
    ];
    expect(searchLinks(links, "spicy")).toEqual([links[0]]);
  });

  it("handles null notes and reviewNote without throwing", () => {
    const links = [makeLink({ id: "a", notes: null, reviewNote: null })];
    expect(searchLinks(links, "anything")).toHaveLength(0);
  });

  it("returns multiple matches", () => {
    const links = [
      makeLink({ id: "a", notes: "chicken pasta" }),
      makeLink({ id: "b", notes: "chicken soup" }),
      makeLink({ id: "c", notes: "cake" }),
    ];
    expect(searchLinks(links, "chicken")).toHaveLength(2);
  });

  it("matches across fields — url matches even when notes does not", () => {
    const link = makeLink({
      id: "a",
      url: "https://instagram.com/p/abc123",
      notes: "chocolate cake",
    });
    expect(searchLinks([link], "instagram")).toEqual([link]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- search-links
```

Expected: `Cannot find module '@/lib/search-links'`

- [ ] **Step 3: Implement `searchLinks`**

Create `src/lib/search-links.ts`:

```ts
import type { LinkItem } from "@/types/link";

export function searchLinks(links: LinkItem[], query: string): LinkItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return links;
  return links.filter(
    (l) =>
      l.url.toLowerCase().includes(q) ||
      (l.notes?.toLowerCase().includes(q) ?? false) ||
      (l.reviewNote?.toLowerCase().includes(q) ?? false),
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- search-links
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/search-links.ts src/lib/__tests__/search-links.test.ts
git commit -m "feat: add searchLinks pure filter function with tests"
```

---

## Task 2: Remove notes from schema and submit form

**Files:**
- Modify: `src/lib/validations.ts`
- Modify: `src/lib/actions.ts`
- Modify: `src/components/submit-link-form.tsx`

`notes` is now system-owned. Remove it from the user-facing submit path entirely.

- [ ] **Step 1: Update `submitLinkSchema`**

In `src/lib/validations.ts`, replace the `submitLinkSchema` definition:

```ts
export const submitLinkSchema = z.object({
  url: z.string().url("Must be a valid URL"),
});
```

- [ ] **Step 2: Update `submitLink` server action**

In `src/lib/actions.ts`, update the `safeParse` call and `link.create` data:

```ts
// Change this:
const parsed = submitLinkSchema.safeParse({
  url: formData.get("url"),
  notes: formData.get("notes") || undefined,
});

// To this:
const parsed = submitLinkSchema.safeParse({
  url: formData.get("url"),
});
```

And update the `link.create` call — remove the `notes` field:

```ts
const link = await prisma.link.create({
  data: {
    url: parsed.data.url,
    submittedById: session.user.id,
  },
});
```

- [ ] **Step 3: Remove notes textarea from submit form**

In `src/components/submit-link-form.tsx`, delete the `<Textarea>` block and its import if unused:

```tsx
// Remove these lines entirely:
<Textarea
  id="notes"
  name="notes"
  placeholder="Add a note (optional)..."
  rows={2}
  className="bg-background/50 border-border/60 resize-none text-sm"
/>
```

If `Textarea` is no longer imported anywhere else in the file, remove its import line too.

- [ ] **Step 4: Run full test suite to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations.ts src/lib/actions.ts src/components/submit-link-form.tsx
git commit -m "feat: remove notes from submit form — now system-owned"
```

---

## Task 3: Add search UI to dashboard

**Files:**
- Modify: `src/components/dashboard.tsx`

- [ ] **Step 1: Add import and state**

At the top of `src/components/dashboard.tsx`, add the import:

```ts
import { searchLinks } from "@/lib/search-links";
```

Inside the `Dashboard` function, add state after the existing `useState` declarations:

```ts
const [searchQuery, setSearchQuery] = useState("");
```

- [ ] **Step 2: Add `searchedLinks` memo and wire into filter chain**

Add a new `searchedLinks` memo immediately before the `filtered` memo:

```ts
const searchedLinks = useMemo(
  () => searchLinks(links, searchQuery),
  [links, searchQuery],
);
```

Update `filtered` to start from `searchedLinks` instead of `links`, and update its dependency array:

```ts
const filtered = useMemo(() => {
  let out = searchedLinks;

  if (ratings.size > 0) {
    out = out.filter((l) => ratings.has(l.rating as RatingOpt));
  }
  if (categories.size > 0) {
    out = out.filter((l) => l.category !== null && categories.has(l.category));
  }
  if (urgencies.size > 0) {
    out = out.filter((l) => l.urgency !== null && urgencies.has(l.urgency));
  }
  if (tandoorOnly) {
    out = out.filter((l) => l.tandoorRecipeId != null);
  }

  return out;
}, [searchedLinks, ratings, categories, urgencies, tandoorOnly]);
```

Update the four count memos (`ratingCounts`, `categoryCounts`, `urgencyCounts`, `tandoorCount`) to iterate over `searchedLinks` instead of `links`, and add `searchedLinks` to each dependency array. For example:

```ts
const ratingCounts = useMemo(() => {
  const counts: Record<RatingOpt, number> = { PENDING: 0, GOOD: 0, BAD: 0 };
  for (const l of searchedLinks) {   // <-- was `links`
    if (categories.size > 0 && (!l.category || !categories.has(l.category))) continue;
    if (urgencies.size > 0 && (!l.urgency || !urgencies.has(l.urgency))) continue;
    if (tandoorOnly && l.tandoorRecipeId == null) continue;
    if (counts[l.rating as RatingOpt] !== undefined) {
      counts[l.rating as RatingOpt]++;
    }
  }
  return counts;
}, [searchedLinks, categories, urgencies, tandoorOnly]);  // <-- was `links`
```

Apply the same `searchedLinks` substitution to `categoryCounts`, `urgencyCounts`, and `tandoorCount`.

- [ ] **Step 3: Update `hasActiveFilters` and reset button**

```ts
const hasActiveFilters =
  activeCount(ratings, categories, urgencies, tandoorOnly) > 0 ||
  searchQuery.trim() !== "";
```

In the Reset all `onClick` handler, add `setSearchQuery("")`:

```ts
onClick={() => {
  setRatings(new Set());
  setCategories(new Set());
  setUrgencies(new Set());
  setTandoorOnly(false);
  setSearchQuery("");
}}
```

- [ ] **Step 4: Add search input to the filter card**

Inside the filter card `<div className="glass-card rounded-xl overflow-hidden">`, add the search input as the first child, before the toggle button:

```tsx
{/* Search — always visible */}
<div className="px-4 pt-3 pb-2">
  <input
    type="search"
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    placeholder="Search notes, URL…"
    className="w-full bg-background/50 border border-border/60 rounded-lg px-3 py-2 text-sm outline-none focus:border-border placeholder:text-muted-foreground/40"
  />
</div>
```

- [ ] **Step 5: Update empty state message**

In the empty state block, update the no-results message to mention search:

```tsx
<p className="text-muted-foreground text-sm">
  {!hasActiveFilters
    ? "No links submitted yet"
    : "No recipes match your filters"}
</p>
```

This already works correctly since `hasActiveFilters` now includes search — no change needed here.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard.tsx
git commit -m "feat: add text search to dashboard filter bar"
```

---

## Task 4: Auto-populate notes after media resolution

**Files:**
- Modify: `src/lib/media-store.ts`

Extend `doResolve` to write `Link.notes` from scraped description. Best-effort — never block media resolution on notes failure.

- [ ] **Step 1: Non-Instagram — include notes in the link update transaction**

In `src/lib/media-store.ts`, inside the `doResolve` function, find the `prisma.$transaction` block and update the `link.update` call to include `notes`:

```ts
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
    data: {
      mediaAssetId: id,
      mediaStatus: "RESOLVED",
      ...(description ? { notes: description.slice(0, 500) } : {}),
    },
  });
  return created;
});
```

- [ ] **Step 2: Instagram — scrape description after transaction**

In `doResolve`, after the `console.log` that logs the resolved asset, add an Instagram-specific notes scrape block. This goes inside `doResolve`, after the `prisma.$transaction` call returns:

```ts
// Best-effort notes scrape for Instagram
if (isInstagramUrl(url)) {
  try {
    const { scrapeSocialMediaPost } = await import("@/lib/scrape-social");
    const scraped = await scrapeSocialMediaPost(url);
    if (scraped.description) {
      await prisma.link.update({
        where: { id: linkId },
        data: { notes: scraped.description.slice(0, 500) },
      });
      console.log(`[media-store] notes scraped for ${url}: "${scraped.description.slice(0, 80)}"`);
    } else {
      console.log(`[media-store] no description scraped for ${url}`);
    }
  } catch (err) {
    console.error(
      `[media-store] notes scrape failed (non-fatal) for ${url}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass (no tests for media-store — verify no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/lib/media-store.ts
git commit -m "feat: auto-populate Link.notes from scraped description after media resolution"
```

---

## Task 5: Backfill script

**Files:**
- Create: `scripts/backfill-notes.ts`

One-shot script. Follow the same pattern as `prisma/seed.ts`: use `import "dotenv/config"` and relative imports (no `@/` aliases).

- [ ] **Step 1: Create the script**

Create `scripts/backfill-notes.ts`:

```ts
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

function extractMeta(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?)(?:property|name)=["']${property}["'][^>]*?content=["']([^"']*?)["']|<meta\\s+(?:[^>]*?)content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(regex);
  return match ? match[1] || match[2] || null : null;
}

async function getOgDescription(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    return (
      extractMeta(html, "og:description") ||
      extractMeta(html, "twitter:description") ||
      null
    );
  } catch {
    return null;
  }
}

async function main() {
  const links = await prisma.link.findMany({
    where: { notes: null },
    include: { mediaAsset: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${links.length} links without notes`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const link of links) {
    process.stdout.write(`[${link.id}] ${link.url.slice(0, 60)}… `);

    try {
      let description: string | null = null;

      if (isInstagramUrl(link.url)) {
        const browserlessKey = process.env.BROWSERLESS_API_KEY;
        if (!browserlessKey) {
          console.log("SKIP (no BROWSERLESS_API_KEY)");
          skipped++;
          continue;
        }
        const { chromium } = await import("playwright-core");
        const browser = await chromium.connect(
          `wss://production-sfo.browserless.io/chromium/playwright?token=${browserlessKey}&launch={"args":["--disable-blink-features=AutomationControlled"]}`,
        );
        const context = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();
        try {
          await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
          // Dismiss cookie banner
          try {
            await page
              .locator("button:has-text('Allow all cookies'), button:has-text('Alle Cookies erlauben')")
              .first()
              .click({ timeout: 5_000 });
          } catch {}
          await page.waitForTimeout(1_000);
          // Expand caption
          try {
            await page.locator("span[role='link']:has-text('more')").first().click({ timeout: 5_000 });
            await page.waitForTimeout(1_000);
          } catch {}

          for (let attempt = 0; attempt < 10; attempt++) {
            await page.waitForTimeout(1_000);
            const result = await page.evaluate(() => {
              const descriptions: string[] = [];
              for (const s of ["meta[property='og:description']", "meta[property='twitter:description']"]) {
                const el = document.querySelector(s) as HTMLMetaElement | null;
                if (el?.content) descriptions.push(el.content);
              }
              const h1 = document.querySelector("h1");
              if (h1?.textContent && h1.textContent.length > 50) descriptions.push(h1.textContent);
              const article = document.querySelector("article");
              if (article) {
                const spans = article.querySelectorAll("span");
                let longest = "";
                spans.forEach((s) => { if ((s.textContent?.length ?? 0) > longest.length) longest = s.textContent!; });
                if (longest.length > 50) descriptions.push(longest);
              }
              descriptions.sort((a, b) => b.length - a.length);
              return descriptions[0] || null;
            });
            if (result) { description = result; break; }
          }
        } finally {
          await context.close();
          await browser.close();
        }
      } else if (link.mediaAsset?.description) {
        description = link.mediaAsset.description;
      } else {
        description = await getOgDescription(link.url);
      }

      if (description) {
        await prisma.link.update({
          where: { id: link.id },
          data: { notes: description.slice(0, 500) },
        });
        console.log(`OK — "${description.slice(0, 60)}"`);
        updated++;
      } else {
        console.log("SKIP (no description found)");
        skipped++;
      }
    } catch (err) {
      console.log(`FAIL — ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run a dry-run check (no writes) to verify it connects**

```bash
DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2-)" npx tsx scripts/backfill-notes.ts 2>&1 | head -5
```

Expected: prints `Found N links without notes` and starts processing.

- [ ] **Step 3: Run the full backfill**

```bash
npx tsx scripts/backfill-notes.ts
```

Expected output ends with: `Done. updated=X skipped=Y failed=0`

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-notes.ts
git commit -m "feat: add backfill-notes script to populate notes from scraped descriptions"
```

---

## Self-Review Checklist

- [x] **Search function**: Task 1 implements `searchLinks`, Task 3 wires it into dashboard ✓
- [x] **Notes auto-population**: Task 4 covers both Instagram (playwright scrape) and non-Instagram (OG description) ✓
- [x] **Submit form removal**: Task 2 removes notes from schema, action, and form ✓
- [x] **API route coverage**: `POST /api/links` uses `submitLinkSchema` — covered automatically by Task 2 ✓
- [x] **Backfill script**: Task 5, same logic as new-link path ✓
- [x] **Count memos in dashboard**: Task 3 Step 2 updates all four count memos to use `searchedLinks` ✓
- [x] **Reset clears search**: Task 3 Step 3 ✓
- [x] **500-char truncation**: Applied in both Task 4 and Task 5 ✓
