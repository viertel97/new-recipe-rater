# Generic-Website Recipe Import to Tandoor

**Date:** 2026-08-12
**Status:** Approved, pending implementation

## Problem

Today `importToTandoor(linkId)` in `src/lib/actions.ts` branches on URL type:

- **Social** (`instagram.com`, `tiktok.com`): headless-browser scrape of the
  caption → Tandoor `/api/ai-import/` → `/api/recipe/` → PUT recipe image.
  Fully auto-creates the recipe. Works well.
- **Non-social** (everything else): `importBookmarkletToTandoor` fetches the
  page HTML and posts it to Tandoor `/api/bookmarklet-import/`, then returns a
  URL the user must click to finish the import inside Tandoor's own UI. That
  endpoint relies on Tandoor scraping structured data (JSON-LD) from the page.

Users want to submit ordinary recipe-blog links — e.g.
`https://vegan-high-protein.de/blogs/rezepte/smashed-potato-doner-salat-1` —
and have the recipe created **directly** in Tandoor, with a real thumbnail, no
manual step. Goal is to support this for **all** websites, verified first on the
example above.

### Why the current path fails on the example

Inspected the target page's raw HTML:

- **No JSON-LD** (`application/ld+json`) at all → Tandoor's bookmarklet-import
  has nothing structured to scrape, so it half-fails.
- The full recipe (Zutaten / Anleitung / Nährwerte) is present as **plain body
  text** in the static HTML.
- `og:image` is only the **site logo**. The real recipe photo is the Shopify
  video-poster image (`/cdn/shop/files/preview_images/*.thumbnail.*.jpg`), which
  **is** present in the static HTML `srcset` — so no browser is needed to find
  it, only a smarter image picker.

## Decisions

1. **Extraction strategy:** JSON-LD Recipe first; fall back to sending readable
   page text to Tandoor `ai-import`. (Chosen over browser-scrape-everything and
   plain-HTTP-only.)
2. **Replace the bookmarklet path** with direct auto-create. No more
   manual-click import URL for non-social links.
3. **No headless browser for generic sites.** Plain server-side `fetch` of the
   page HTML is enough: recipe text and a usable thumbnail both live in the
   static HTML. The browser path stays reserved for social scraping.

## Architecture

### New pure module: `src/lib/web-recipe.ts`

No I/O — takes HTML, returns extracted data. Fully unit-testable.

```ts
type TandoorRecipe = {
  name: string;
  servings: number;
  steps: { instruction: string; ingredients: TandoorIngredient[] }[];
  // ...shape matching what /api/recipe/ accepts (mirror ai-import output)
};

type ExtractedRecipe = {
  structured: TandoorRecipe | null; // set when JSON-LD Recipe found
  text: string;                     // readable page text for AI fallback
  imageUrl: string | null;          // best thumbnail candidate (absolute URL)
};

function extractRecipeFromHtml(url: string, html: string): ExtractedRecipe;
```

Responsibilities:

- **JSON-LD parse:** collect all `application/ld+json` blocks, JSON-parse each
  (tolerate arrays and `@graph`), find the object whose `@type` is `Recipe`
  (or includes `"Recipe"`). Map to `TandoorRecipe`:
  - `name` ← `name`
  - ingredients ← `recipeIngredient[]` (one step's ingredient list, parsed
    leniently — free-text is acceptable; Tandoor tolerates loose ingredients)
  - steps ← `recipeInstructions` (string, array of strings, or array of
    `HowToStep {text}`)
  - `servings` ← `recipeYield` (first integer found, default 1)
  - image candidate ← `image` (string, array, or `{url}`)
- **Text extraction (AI fallback):** when no Recipe schema, strip
  `<script>`/`<style>`/`<nav>`/`<header>`/`<footer>`, drop tags, unescape
  entities, collapse whitespace. Return the main readable text.
- **Image picker** (used by both paths), in priority order:
  1. JSON-LD `image` (resolved absolute)
  2. best content photo from HTML: scan `img` `src`/`data-src`/`srcset`,
     resolve protocol-relative and relative URLs against `url`, prefer
     `.jpg/.jpeg/.webp/.png`, **prefer** Shopify `preview_images` posters and
     larger declared widths, **exclude** logos/icons/`.svg`/tiny widths
     (e.g. `width<200`)/known affiliate hosts
  3. `og:image` as last resort
  Returns `null` if nothing qualifies.

Reuse `extractMeta` / `extractTitleTag` from `src/lib/og.ts` where useful.

### New shared module: `src/lib/tandoor.ts`

Extract the Tandoor HTTP calls currently inlined in
`importSocialMediaToTandoor` so both paths share them:

- `aiImportText(text): Promise<TandoorRecipe>` — POST `/api/ai-import/`
  (multipart, honoring `TANDOOR_AI_PROVIDER_ID`), returns the parsed recipe;
  throws on error.
- `createTandoorRecipe(recipe, sourceUrl): Promise<{ id: number }>` — POST
  `/api/recipe/` with `source_url` and `servings` defaulted.
- `uploadTandoorImage(recipeId, imageUrl): Promise<void>` — PUT
  `/api/recipe/{id}/image/` with `image_url`; best-effort, non-fatal on failure.

Config (`TANDOOR_URL`, `TANDOOR_TOKEN`, `TANDOOR_AI_PROVIDER_ID`) read as today.

### `actions.ts` changes

- `importSocialMediaToTandoor` refactored to call the shared `tandoor.ts`
  helpers (behavior unchanged).
- `importBookmarkletToTandoor` **removed**, replaced by
  `importGenericToTandoor(linkId, url, tandoorUrl, tandoorToken)`:
  1. `fetch(url)` the page HTML (existing UA header).
  2. `extractRecipeFromHtml(url, html)`.
  3. If `structured` → `createTandoorRecipe(structured, url)`; else if `text`
     non-empty → `aiImportText(text)` then `createTandoorRecipe(...)`; else
     return `{ error: "Could not extract a recipe from this page" }`.
  4. `uploadTandoorImage(id, imageUrl)` when `imageUrl` present (best-effort).
  5. `prisma.link.update({ tandoorRecipeId })`, `revalidatePath("/")`,
     return `{ success: true, tandoorRecipeId }`.
- `importToTandoor`'s branch now calls `importGenericToTandoor` for non-social
  URLs. The `isSocialMediaUrl` split is unchanged.

## Data flow

```
importToTandoor(linkId)
  ├─ social URL  → scrapeSocialMediaPost → aiImportText → createTandoorRecipe → uploadTandoorImage
  └─ generic URL → fetch HTML → extractRecipeFromHtml
                     ├─ structured (JSON-LD) → createTandoorRecipe
                     └─ text only           → aiImportText → createTandoorRecipe
                   → uploadTandoorImage
```

Return shape aligns with the social path: `{ success, tandoorRecipeId }` on
success, `{ error }` on failure. The UI (`link-card.tsx`) already handles this
shape; the manual `importUrl` return value is no longer produced.

## Error handling & logging

- Match the existing `console.log("[importGeneric] ...")` breadcrumb style
  (fetch status, JSON-LD found?, text length, AI recipe name, created id, image
  upload status).
- Fetch failure → `{ error: "Failed to fetch recipe page" }`.
- No extractable recipe → explicit error (no silent fallback).
- Image upload failure is logged and ignored (recipe still created).

## Testing

Vitest unit tests on the pure `web-recipe.ts` (no network):

- **JSON-LD mapping:** a fixture with an `@graph` Recipe maps name/ingredients/
  steps/servings/image correctly; array-form `recipeInstructions` and
  `HowToStep` objects both handled.
- **AI-fallback text:** the saved vegan-high-protein HTML yields non-empty text
  containing "Zutaten"/"Anleitung", and `structured` is `null`.
- **Image picker:** on the vegan-high-protein fixture it returns a
  `preview_images` poster (a `.jpg`), **not** the logo `og:image`; svg/icon/
  tiny-width candidates are excluded.

Store fixtures under `src/lib/__tests__/fixtures/` (or the repo's existing test
fixture location if one exists).

## Out of scope

- No Prisma schema change (`tandoorRecipeId` already exists on `Link`).
- No changes to social scraping, categorization, or the submit flow.
- Hopping from a blog page to its embedded Instagram post for a richer caption —
  the on-page text is richer than the caption, so not needed.
