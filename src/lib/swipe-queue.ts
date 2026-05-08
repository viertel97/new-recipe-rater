import { useState, useRef, useMemo, useCallback, useEffect, startTransition } from "react";
import type { LinkItem, Category, Urgency } from "@/types/link";
import { rateLink } from "@/lib/actions";

export type SwipeFilters = {
  categories: Category[];
  includeUncategorized: boolean;
};

export type SwipeQueue = {
  active: LinkItem | null;
  next: LinkItem | null;
  remaining: number;
  cursor: number;
  stats: { liked: number; noped: number };
  rate: (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => void;
  navigateNext: () => void;
  navigatePrev: () => void;
};

function matchesFilter(link: LinkItem, f: SwipeFilters): boolean {
  const noConstraint = f.categories.length === 0 && f.includeUncategorized;
  if (noConstraint) return true;
  if (link.category == null) return f.includeUncategorized;
  return f.categories.includes(link.category);
}

export function useSwipeQueue(initialLinks: LinkItem[], filters: SwipeFilters): SwipeQueue {
  const [snapshot] = useState<LinkItem[]>(() => initialLinks);
  const [ratedIds, setRatedIds] = useState<Set<string>>(() => new Set());
  const [stats, setStats] = useState({ liked: 0, noped: 0 });
  const [cursor, setCursor] = useState(0);
  const ratedIdsRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef(0);

  const visible = useMemo(
    () => snapshot.filter((l) => !ratedIds.has(l.id) && matchesFilter(l, filters)),
    [snapshot, ratedIds, filters]
  );

  const visibleLengthRef = useRef(visible.length);
  visibleLengthRef.current = visible.length;

  // Clamp cursor when visible shrinks (after rating)
  useEffect(() => {
    if (visible.length === 0) {
      cursorRef.current = 0;
      setCursor(0);
    } else if (cursorRef.current >= visible.length) {
      const clamped = visible.length - 1;
      cursorRef.current = clamped;
      setCursor(clamped);
    }
  }, [visible.length]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rate = useCallback(
    (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => {
      if (ratedIdsRef.current.has(id)) return;
      ratedIdsRef.current.add(id);
      setRatedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setStats((s) => (rating === "GOOD" ? { ...s, liked: s.liked + 1 } : { ...s, noped: s.noped + 1 }));
      startTransition(() => {
        rateLink(id, rating, opts);
      });
    },
    []
  );

  const navigateNext = useCallback(() => {
    setCursor((c) => {
      const next = Math.min(c + 1, visibleLengthRef.current - 1);
      cursorRef.current = next;
      return next;
    });
  }, []);

  const navigatePrev = useCallback(() => {
    setCursor((c) => {
      if (c <= 0) return c;
      const prev = c - 1;
      cursorRef.current = prev;
      return prev;
    });
  }, []);

  return {
    active: visible[cursor] ?? null,
    next: visible[cursor + 1] ?? null,
    remaining: visible.length,
    cursor,
    stats,
    rate,
    navigateNext,
    navigatePrev,
  };
}
