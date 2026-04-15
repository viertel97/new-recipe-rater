# Tinder View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-only, full-screen swipe interface at `/swipe` for rapidly rating PENDING recipe links — swipe right (GOOD) or left (BAD), with an urgency picker after GOOD swipes.

**Architecture:** New App Router page at `src/app/swipe/page.tsx` (server component, auth-gated) fetches PENDING links and passes them to a client `SwipeView` orchestrator. `SwipeView` manages deck state and renders individual `SwipeCard` components that handle pointer/touch drag gestures via CSS transforms. An `UrgencySheet` bottom sheet appears after GOOD swipes. All animations are custom CSS — no external gesture/animation libraries.

**Tech Stack:** Next.js 16 App Router, React 19 (`useOptimistic`, `startTransition`), Tailwind CSS v4 (oklch tokens in `globals.css`), existing `rateLink` server action, existing `/api/instagram` and `/api/og` endpoints.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/types/link.ts` | Shared `LinkItem`, `Urgency`, `OgData` types (extracted from duplication) |
| Modify | `src/components/link-card.tsx` | Import types from `src/types/link.ts` instead of local definition |
| Modify | `src/components/dashboard.tsx` | Import types from `src/types/link.ts` instead of local definition |
| Create | `src/app/swipe/page.tsx` | Server component — auth gate, fetch PENDING links, desktop gate |
| Create | `src/components/swipe-view.tsx` | Client orchestrator — deck state, card transitions, session stats |
| Create | `src/components/swipe-card.tsx` | Single card — drag gestures, video/OG rendering, stamps |
| Create | `src/components/urgency-sheet.tsx` | Bottom sheet — urgency picker after GOOD swipe |
| Modify | `src/components/header.tsx` | Add mobile-only swipe button (link to `/swipe`) |
| Modify | `src/app/globals.css` | Add swipe-specific keyframes and utility classes |
| Modify | `src/middleware.ts` | No changes needed — `/swipe` auto-protected by existing matcher |

---

### Task 1: Extract Shared Types

**Files:**
- Create: `src/types/link.ts`
- Modify: `src/components/link-card.tsx:7-32`
- Modify: `src/components/dashboard.tsx:6-17`

- [ ] **Step 1: Create shared types file**

Create `src/types/link.ts`:

```ts
export type Urgency = "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE";

export type LinkItem = {
  id: string;
  url: string;
  rating: "PENDING" | "GOOD" | "BAD";
  urgency: Urgency | null;
  notes: string | null;
  reviewNote: string | null;
  tandoorRecipeId: number | null;
  createdAt: Date;
  submittedById: string;
  submittedBy: { name: string | null; email: string | null };
};

export type OgData = {
  title: string | null;
  image: string | null;
  description: string | null;
  siteName: string | null;
};
```

- [ ] **Step 2: Update link-card.tsx imports**

In `src/components/link-card.tsx`, remove the local `type Urgency`, `type LinkItem`, and `type OgData` definitions (lines 7–32). Replace with:

```ts
import { type Urgency, type LinkItem, type OgData } from "@/types/link";
```

Keep all other code unchanged.

- [ ] **Step 3: Update dashboard.tsx imports**

In `src/components/dashboard.tsx`, remove the local `type LinkItem` definition (lines 6–17). Replace with:

```ts
import { type LinkItem } from "@/types/link";
```

- [ ] **Step 4: Verify nothing broke**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/link.ts src/components/link-card.tsx src/components/dashboard.tsx
git commit -m "Extract shared LinkItem, Urgency, OgData types to src/types/link.ts"
```

---

### Task 2: Add Swipe Keyframes and CSS Utilities

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add swipe keyframes and classes**

Add the following at the end of `src/app/globals.css` (after the scrollbar styles, before the closing):

```css
/* Swipe view */
@keyframes sheet-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.animate-sheet-up {
  animation: sheet-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.swipe-stamp {
  font-size: 2.5rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.25rem 1rem;
  border: 4px solid currentColor;
  border-radius: 0.5rem;
  transform: rotate(-12deg);
  pointer-events: none;
  user-select: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "Add swipe view keyframes and stamp utility class"
```

---

### Task 3: Create the Swipe Page (Server Component)

**Files:**
- Create: `src/app/swipe/page.tsx`

- [ ] **Step 1: Create the server component**

Create `src/app/swipe/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SwipeView } from "@/components/swipe-view";

export default async function SwipePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const links = await prisma.link.findMany({
    where: { rating: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { submittedBy: { select: { name: true, email: true } } },
  });

  return <SwipeView links={links} />;
}
```

- [ ] **Step 2: Create a placeholder SwipeView so the page compiles**

Create `src/components/swipe-view.tsx` with a minimal placeholder:

```tsx
"use client";

import { type LinkItem } from "@/types/link";

export function SwipeView({ links }: { links: LinkItem[] }) {
  return (
    <div className="h-dvh bg-background flex items-center justify-center">
      <p className="text-muted-foreground">SwipeView placeholder — {links.length} pending</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify page loads**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds. `/swipe` route listed in output.

- [ ] **Step 4: Commit**

```bash
git add src/app/swipe/page.tsx src/components/swipe-view.tsx
git commit -m "Add /swipe route with server component and placeholder SwipeView"
```

---

### Task 4: Build the Swipe Card Component

**Files:**
- Create: `src/components/swipe-card.tsx`

This is the core card component. It handles:
- Full-bleed rendering (video for Instagram, OG image for other URLs)
- Pointer/touch drag gestures with CSS transforms
- LIKE/NOPE stamp overlays that fade in proportional to drag distance
- Release behavior: snap back below threshold, fly off above threshold

- [ ] **Step 1: Create swipe-card.tsx**

Create `src/components/swipe-card.tsx`:

```tsx
"use client";

import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { type LinkItem, type OgData } from "@/types/link";

export type SwipeCardHandle = {
  triggerSwipe: (direction: "left" | "right") => void;
};

const SWIPE_THRESHOLD = 0.3; // 30% of screen width
const MAX_ROTATION = 15; // degrees
const ROTATION_FACTOR = 0.06;

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

type MediaData =
  | { type: "video"; videoUrl: string; thumbnail?: string }
  | { type: "image"; ogData: OgData }
  | { type: "loading" }
  | { type: "error" };

function useMediaData(url: string): MediaData {
  const [data, setData] = useState<MediaData>({ type: "loading" });

  useEffect(() => {
    let cancelled = false;

    if (isInstagramUrl(url)) {
      fetch(`/api/instagram?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((json) => {
          if (cancelled) return;
          const media = json.media?.[0];
          if (media?.type === "video") {
            setData({ type: "video", videoUrl: media.url, thumbnail: media.thumbnail });
          } else if (media?.url) {
            setData({ type: "image", ogData: { title: null, image: media.url, description: null, siteName: "Instagram" } });
          } else {
            setData({ type: "error" });
          }
        })
        .catch(() => !cancelled && setData({ type: "error" }));
    } else {
      fetch(`/api/og?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((ogData) => !cancelled && setData({ type: "image", ogData }))
        .catch(() => !cancelled && setData({ type: "error" }));
    }

    return () => { cancelled = true; };
  }, [url]);

  return data;
}

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
  const media = useMediaData(link.url);

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
      {/* Background layer */}
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
              if (videoRef.current) videoRef.current.muted = !muted;
            }}
          />
        )}
        {media.type === "image" && media.ogData.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.ogData.image}
            alt={media.ogData.title || ""}
            className="w-full h-full object-cover"
          />
        )}
        {media.type === "image" && !media.ogData.image && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              className="w-16 h-16 rounded-xl opacity-60"
            />
            <p className="text-sm text-muted-foreground font-medium">{domain}</p>
            {media.ogData.title && (
              <p className="text-lg font-semibold text-foreground text-center px-8 line-clamp-3">{media.ogData.title}</p>
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

      {/* Color overlay (green/red tint proportional to drag) */}
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

      {/* Tap-to-open for non-video cards */}
      {isNonVideoCard && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-5"
          onClick={(e) => {
            // Only open link on tap, not after drag
            if (Math.abs(deltaX) > 5) e.preventDefault();
          }}
        />
      )}

      {/* Gradient overlay */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "50%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
        }}
      />

      {/* Mute indicator */}
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

      {/* Recipe info overlay */}
      <div className="absolute bottom-20 left-0 right-0 px-5 z-10 pointer-events-none">
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/50 font-medium mb-1">{domain}</p>
        <p className="text-base font-semibold text-white line-clamp-2 leading-snug">
          {(media.type === "image" && media.ogData.title) || link.url}
        </p>
        <p className="text-xs text-white/40 mt-1.5">
          {submitterName} · {dateStr}
        </p>
      </div>

      {/* LIKE stamp */}
      <div
        className="absolute top-20 left-6 z-20 pointer-events-none"
        style={{ opacity: isRight ? stampOpacity : 0 }}
      >
        <span className="swipe-stamp" style={{ color: "oklch(0.55 0.15 145)", borderColor: "oklch(0.55 0.15 145)" }}>
          LIKE
        </span>
      </div>

      {/* NOPE stamp */}
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

- [ ] **Step 2: Verify it compiles**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds (SwipeCard not rendered yet, just needs to compile).

- [ ] **Step 3: Commit**

```bash
git add src/components/swipe-card.tsx
git commit -m "Add SwipeCard component with drag gestures and media rendering"
```

---

### Task 5: Build the Urgency Sheet Component

**Files:**
- Create: `src/components/urgency-sheet.tsx`

- [ ] **Step 1: Create urgency-sheet.tsx**

Create `src/components/urgency-sheet.tsx`:

```tsx
"use client";

import { useRef, useCallback } from "react";
import { type Urgency } from "@/types/link";

const urgencyOptions: { value: Urgency; label: string; emoji: string; color: string }[] = [
  { value: "TOMORROW", label: "Tomorrow", emoji: "🔥", color: "oklch(0.70 0.18 30)" },
  { value: "NEXT_WEEK", label: "Next week", emoji: "📅", color: "oklch(0.75 0.14 65)" },
  { value: "NEXT_MONTH", label: "Next month", emoji: "📌", color: "oklch(0.70 0.12 220)" },
  { value: "ARCHIVE", label: "Archive", emoji: "📦", color: "oklch(0.55 0.03 260)" },
];

export function UrgencySheet({
  onSelect,
  onSkip,
}: {
  onSelect: (urgency: Urgency) => void;
  onSkip: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const draggingSheet = useRef(false);

  const handleSheetPointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    draggingSheet.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleSheetPointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingSheet.current) return;
    draggingSheet.current = false;
    const dy = e.clientY - dragStartY.current;
    if (dy > 80) onSkip();
  }, [onSkip]);

  return (
    <div className="absolute inset-0 z-30">
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onSkip} />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 animate-sheet-up rounded-t-2xl overflow-hidden"
        style={{ background: "oklch(0.17 0.005 250)" }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handleSheetPointerDown}
          onPointerUp={handleSheetPointerUp}
        >
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-6 pb-8">
          <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-4">
            When to cook?
          </p>

          {/* 2x2 grid */}
          <div className="grid grid-cols-2 gap-3">
            {urgencyOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSelect(opt.value)}
                className="flex flex-col items-center gap-2 py-4 rounded-xl border transition-all duration-200 active:scale-95"
                style={{
                  borderColor: `color-mix(in oklch, ${opt.color} 30%, transparent)`,
                  background: `color-mix(in oklch, ${opt.color} 8%, transparent)`,
                }}
              >
                <span className="text-2xl">{opt.emoji}</span>
                <span className="text-xs font-medium" style={{ color: opt.color }}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>

          {/* Skip link */}
          <button
            onClick={onSkip}
            className="w-full text-center mt-4 py-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/urgency-sheet.tsx
git commit -m "Add UrgencySheet bottom sheet component"
```

---

### Task 6: Build the SwipeView Orchestrator

**Files:**
- Modify: `src/components/swipe-view.tsx` (replace placeholder)

This is the main orchestrator. It:
- Manages current card index and session stats
- Shows desktop gate message on wide viewports
- Renders the card stack, urgency sheet, and action buttons
- Handles empty and completion states
- Preloads media for upcoming cards

- [ ] **Step 1: Replace swipe-view.tsx with full implementation**

Replace the entire contents of `src/components/swipe-view.tsx`:

```tsx
"use client";

import { useState, useCallback, startTransition, useRef, useEffect } from "react";
import { type LinkItem, type Urgency } from "@/types/link";
import { rateLink } from "@/lib/actions";
import { SwipeCard, type SwipeCardHandle } from "@/components/swipe-card";
import { UrgencySheet } from "@/components/urgency-sheet";

export function SwipeView({ links }: { links: LinkItem[] }) {
  const [index, setIndex] = useState(0);
  const [showUrgency, setShowUrgency] = useState(false);
  const [stats, setStats] = useState({ liked: 0, noped: 0 });
  const [isDesktop, setIsDesktop] = useState(false);
  const pendingSwipeId = useRef<string | null>(null);
  const activeCardRef = useRef<SwipeCardHandle>(null);

  // Desktop detection
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Preload media for next 2 cards
  useEffect(() => {
    for (let i = index + 1; i <= index + 2 && i < links.length; i++) {
      const link = links[i];
      const isInsta = /instagram\.com\/(p|reel|reels|tv)\//.test(link.url);
      if (isInsta) {
        fetch(`/api/instagram?url=${encodeURIComponent(link.url)}`);
      } else {
        fetch(`/api/og?url=${encodeURIComponent(link.url)}`);
      }
    }
  }, [index, links]);

  const advance = useCallback(() => {
    setIndex((i) => i + 1);
    setShowUrgency(false);
  }, []);

  const handleSwipe = useCallback((direction: "left" | "right") => {
    const link = links[index];
    if (!link) return;

    if (direction === "left") {
      setStats((s) => ({ ...s, noped: s.noped + 1 }));
      startTransition(() => { rateLink(link.id, "BAD"); });
      advance();
    } else {
      // Right swipe — show urgency sheet
      pendingSwipeId.current = link.id;
      setStats((s) => ({ ...s, liked: s.liked + 1 }));
      setShowUrgency(true);
    }
  }, [index, links, advance]);

  const handleUrgencySelect = useCallback((urgency: Urgency) => {
    if (pendingSwipeId.current) {
      startTransition(() => { rateLink(pendingSwipeId.current!, "GOOD", { urgency }); });
    }
    pendingSwipeId.current = null;
    advance();
  }, [advance]);

  const handleUrgencySkip = useCallback(() => {
    if (pendingSwipeId.current) {
      startTransition(() => { rateLink(pendingSwipeId.current!, "GOOD"); });
    }
    pendingSwipeId.current = null;
    advance();
  }, [advance]);

  const triggerButtonSwipe = useCallback((direction: "left" | "right") => {
    if (activeCardRef.current) {
      activeCardRef.current.triggerSwipe(direction);
    }
  }, []);

  // Desktop gate
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

  // Empty state
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

  // Completion state
  if (index >= links.length) {
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
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <a href="/" className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-5 h-5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </a>
        <span className="text-xs text-white/50 font-medium bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-full">
          {index + 1} of {links.length}
        </span>
      </div>

      {/* Card stack */}
      <div className="absolute inset-0">
        {links.map((link, i) => {
          if (i < index || i > index + 1) return null;
          const isActive = i === index && !showUrgency;
          return (
            <SwipeCard
              key={link.id}
              ref={isActive ? activeCardRef : null}
              link={link}
              onSwipe={handleSwipe}
              active={isActive}
            />
          );
        })}
      </div>

      {/* Urgency sheet */}
      {showUrgency && (
        <UrgencySheet onSelect={handleUrgencySelect} onSkip={handleUrgencySkip} />
      )}

      {/* Action buttons */}
      {!showUrgency && index < links.length && (
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

- [ ] **Step 2: Verify it compiles**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/swipe-view.tsx
git commit -m "Implement SwipeView orchestrator with deck state, empty/completion states, action buttons"
```

---

### Task 7: Add Swipe Button to Header

**Files:**
- Modify: `src/components/header.tsx`

- [ ] **Step 1: Add mobile-only swipe link**

In `src/components/header.tsx`, inside the right-side `<div className="flex items-center gap-4">`, add a mobile-only link **before** the existing `<span>` element:

```tsx
<a
  href="/swipe"
  className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
  title="Swipe mode"
>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <rect x="2" y="2" width="20" height="20" rx="3" />
    <path d="M9 18l6-6-6-6" />
  </svg>
</a>
```

The full updated right-side div should look like:

```tsx
<div className="flex items-center gap-4">
  <a
    href="/swipe"
    className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
    title="Swipe mode"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <rect x="2" y="2" width="20" height="20" rx="3" />
      <path d="M9 18l6-6-6-6" />
    </svg>
  </a>
  <span className="text-xs text-muted-foreground hidden sm:inline tracking-wide">
    {session.user.name || session.user.email}
  </span>
  <form
    action={async () => {
      "use server";
      await signOut({ redirectTo: "/login" });
    }}
  >
    <Button
      variant="ghost"
      size="sm"
      type="submit"
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      Sign Out
    </Button>
  </form>
</div>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/header.tsx
git commit -m "Add mobile-only swipe button to header"
```

---

### Task 8: Manual Testing and Polish

No new files. This task verifies the feature end-to-end on a mobile viewport.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test desktop gate**

Open `http://localhost:3000/swipe` in a desktop browser.
Expected: "Open on your phone to swipe" message with back link.

- [ ] **Step 3: Test mobile viewport**

Open browser devtools → toggle device toolbar → select a mobile device (e.g. iPhone 14).
Navigate to `/swipe`.

Verify:
- Cards render full-bleed with gradient overlay
- Recipe info (domain, title, submitter, date) visible at bottom
- Counter shows "1 of N" in top-right
- Back arrow in top-left links to `/`

- [ ] **Step 4: Test swipe gestures**

- Drag card right past 30% threshold → card flies off, urgency sheet appears
- Select an urgency → sheet dismisses, next card appears
- Drag card left past 30% → card flies off, next card appears
- Drag card partially and release → card snaps back to center
- Tap X button → card flies left
- Tap heart button → card flies right, urgency sheet appears
- Tap "Skip" on urgency sheet → rates GOOD without urgency

- [ ] **Step 5: Test empty and completion states**

- If no PENDING links: should show "No recipes to rate" with plate emoji
- After swiping all cards: should show "All caught up!" with session stats

- [ ] **Step 6: Test video cards**

- Instagram reel links should auto-play muted video
- Tap on video area should toggle mute
- Mute indicator icon should update

- [ ] **Step 7: Test header button**

- On mobile viewport: swipe button visible in header
- On desktop viewport: swipe button hidden (`md:hidden`)
- Tapping button navigates to `/swipe`

- [ ] **Step 8: Fix any issues found during testing**

Address bugs discovered in steps 2-7. Commit each fix separately.

- [ ] **Step 9: Final commit if needed**

If any polish changes were made, commit them:
```bash
git add -A
git commit -m "Polish swipe view after manual testing"
```
