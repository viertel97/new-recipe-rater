# Tinder View — Design Spec

Mobile-only swipe interface for rapidly rating PENDING recipe links.

## Decisions

| Question | Decision |
|----------|----------|
| Which links? | PENDING only |
| Rating data | Swipe + urgency picker (no notes) |
| Video playback | Auto-play muted, tap to unmute |
| Non-video links | Included — OG image as full-card background |
| Swipe mechanics | Custom CSS transforms + touch events (no library) |
| Card layout | Full bleed — video fills screen, info overlaid with gradient |
| Urgency picker | Bottom sheet after GOOD swipe |
| Entry point | Dedicated `/swipe` route, header button (mobile only) |

## Route & Navigation

- **Route:** `/swipe` — new page in App Router
- **Entry:** Button in header, visible only on mobile viewports (`md:hidden`)
- **Icon:** Flame or stacked-cards icon
- **Back:** Arrow in top-left corner, navigates to `/`
- **Counter:** "3 of 12" in top-right, shows position in queue
- **Mobile gate:** On desktop viewports, `/swipe` shows a centered message "Open on your phone to swipe" with a back link. No redirect — allows testing via browser devtools responsive mode.

## Card Layout — Full Bleed

Each card fills the entire viewport. Content stacked in layers:

1. **Background layer:** Video (`<video autoPlay muted playsInline>`) or OG image, `object-cover` filling the screen
2. **Gradient overlay:** Bottom 50% gradient from `rgba(0,0,0,0.85)` to transparent
3. **Recipe info** (over gradient, bottom area):
   - Source domain (e.g., "instagram.com") — small uppercase label
   - Recipe title/URL — bold, 1-2 lines
   - Submitter name + date — small muted text
4. **Swipe stamps:** "LIKE" / "NOPE" text that fades in proportional to drag distance
5. **Action buttons:** Bottom bar with X (red) and Heart (green) circle buttons — fallback for users who prefer tapping

### Video Cards (Instagram/TikTok)

- Fetch video URL via existing `/api/instagram` endpoint
- Render as `<video>` with `autoPlay muted playsInline loop`
- Tap anywhere on video area toggles mute
- Small mute/unmute icon indicator in top-right

### Non-Video Cards (Regular URLs)

- Fetch OG data via existing `/api/og` endpoint
- OG image displayed full-bleed with `object-cover`
- If no OG image: dark background with favicon + domain + title centered
- Tap on card opens URL in new tab

## Swipe Interaction

All custom — pointer/touch events + CSS transforms.

### Drag Behavior

- Track `pointerdown` → `pointermove` → `pointerup`
- During drag:
  - `transform: translateX(${deltaX}px) rotate(${deltaX * 0.06}deg)`
  - Max rotation: ~15deg
  - Color overlay fades in: green (right) or red (left), opacity proportional to drag
  - Stamp ("LIKE"/"NOPE") opacity: `Math.min(1, Math.abs(deltaX) / threshold)`

### Release Behavior

- **Below threshold** (< 30% screen width): Spring back to center with CSS transition (`transform: translate(0) rotate(0)`, `transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)`)
- **Above threshold:** Card flies off-screen in drag direction. Animate `translateX` to `±150vw` with same rotation angle. Duration: ~300ms.

### After Release (Above Threshold)

- **BAD (left):** Call `rateLink(id, "BAD")`. Next card animates in from below with `slide-up` animation.
- **GOOD (right):** Card flies off, then urgency bottom sheet appears.

### Button Taps

- X button: Animate card flying left + call `rateLink(id, "BAD")`
- Heart button: Animate card flying right + show urgency sheet

## Urgency Bottom Sheet

Appears after a GOOD swipe. Card stays dimmed in background with "LIKE" stamp visible.

### Layout

- Slides up from bottom with spring animation
- Drag handle at top (32px bar)
- "When to cook?" label
- 2x2 grid of urgency options:
  - Tomorrow (flame emoji, warm orange)
  - Next week (calendar emoji, amber)
  - Next month (pin emoji, blue)
  - Archive (box emoji, muted gray)
- "Skip" link below grid — rates GOOD without urgency

### Behavior

- Tap urgency → call `rateLink(id, "GOOD", { urgency })` → sheet dismisses → next card slides in
- Tap "Skip" → call `rateLink(id, "GOOD")` → same flow
- Swipe down on sheet → same as Skip
- No text note input — keep it fast

## Empty & Completion States

### No Pending Recipes

Shown when entering `/swipe` with zero PENDING links:

- Plate emoji (🍽️)
- "No recipes to rate"
- "Add some recipe links from Instagram or the web, then come back to swipe."
- "Back to dashboard" button → navigates to `/`

### Queue Complete

Shown after swiping through all cards:

- Party emoji (🎉)
- "All caught up!"
- "You've rated all pending recipes."
- Session stats: count of liked / noped in this session (client-side counter)
- "Back to dashboard" button → navigates to `/`

## Data Flow

### Loading

1. Server component at `/swipe` fetches all PENDING links (same query as dashboard with `rating: "PENDING"` filter)
2. Passes array to client component `<SwipeView links={links} />`
3. Client maintains local index into array, advancing after each swipe

### Rating

- Reuse existing `rateLink` server action from `src/lib/actions.ts`
- Optimistic: remove card from stack immediately, don't wait for server response
- On error: show brief toast, card does not return (rating was attempted, avoid confusion)

### Preloading

- Preload media for next 2 cards:
  - Instagram video: fetch `/api/instagram?url=...` for next cards on mount
  - OG images: `<link rel="preload">` or `new Image().src`
- Prevents loading delay between swipes

## Component Structure

```
src/app/swipe/page.tsx          — Server component, auth gate, fetch PENDING links
src/components/swipe-view.tsx   — Client component, orchestrates deck + state
src/components/swipe-card.tsx   — Single card, handles drag gestures + rendering
src/components/urgency-sheet.tsx — Bottom sheet for urgency selection
```

## Styling

- Match existing app: dark editorial palette, oklch colors, DM Sans body, glass effects
- Full viewport height: `h-dvh` (dynamic viewport height for mobile browsers)
- Safe areas: `padding-top: env(safe-area-inset-top)` for notched phones
- No scrolling: `overflow-hidden` on swipe view
- Transitions: `cubic-bezier(0.16, 1, 0.3, 1)` — same easing used throughout app
- Stamps: bold uppercase, bordered, rotated — classic Tinder aesthetic
