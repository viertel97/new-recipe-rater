# Social Media Tandoor Import via AI

## Problem

The current `importToTandoor` action sends raw HTML to Tandoor's bookmarklet-import API. This works for structured recipe websites (e.g., eat-this.org) that have schema.org/Recipe markup, but fails for Instagram/TikTok posts which have no recipe structure — just a caption and an image.

## Solution

Smart-route the Tandoor import based on URL domain:

- **Social media URLs** (instagram.com, tiktok.com): scrape OG meta (description + image) server-side, then send to Tandoor's `/api/ai-import/` endpoint. Tandoor's configured AI provider parses the caption into a structured recipe.
- **Regular recipe URLs**: keep the existing bookmarklet-import flow unchanged.

## Tandoor AI Import API

Endpoint: `POST {TANDOOR_URL}/api/ai-import/`
Auth: `Authorization: Bearer {TANDOOR_TOKEN}`
Content-Type: `multipart/form-data`

Fields:
- `recipe_id`: empty string (new recipe)
- `text`: the post caption/description
- `file`: cover image bytes (or empty string if unavailable)
- `ai_provider_id`: integer ID of the configured AI provider (from env var, or omit for default)

Response: JSON with `recipe` object or `recipe_id` for an existing match.

## Domain Detection

Social media domains:
- `instagram.com`, `www.instagram.com`
- `tiktok.com`, `www.tiktok.com`, `vm.tiktok.com`

Everything else falls through to the existing bookmarklet import.

## Changes

### `src/lib/actions.ts` — `importToTandoor`

1. Add `isSocialMediaUrl(url)` helper — domain check against the list above.
2. For social media URLs:
   - Fetch the page HTML server-side (reuse existing fetch pattern).
   - Extract `og:description` and `og:image` using the same regex helpers from `/api/og/route.ts` (extract into shared utility or inline).
   - Download the OG image bytes.
   - POST multipart form to `/api/ai-import/` with `text`, `file`, and `ai_provider_id`.
   - Return the recipe URL from the response.
3. For regular URLs: no change to existing bookmarklet flow.

### `.env`

Add optional `TANDOOR_AI_PROVIDER_ID` — if set, pass it to the AI import. If not set, Tandoor uses its default provider.

### No UI changes

The "Import to Tandoor" button on GOOD-rated cards works as-is. The routing is transparent server-side.

## Error Handling

- If OG scraping returns no description: return error "Could not extract post content".
- If image download fails: proceed without image (send empty file field).
- If Tandoor AI import fails: return the error message from Tandoor's response.
