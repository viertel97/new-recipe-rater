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
