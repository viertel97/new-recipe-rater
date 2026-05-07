import { useState, useRef, useMemo, useCallback, startTransition } from "react";
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
  stats: { liked: number; noped: number };
  rate: (id: string, rating: "GOOD" | "BAD", opts?: { urgency?: Urgency }) => void;
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
  const ratedIdsRef = useRef<Set<string>>(new Set());

  const visible = useMemo(
    () => snapshot.filter((l) => !ratedIds.has(l.id) && matchesFilter(l, filters)),
    [snapshot, ratedIds, filters]
  );

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

  return {
    active: visible[0] ?? null,
    next: visible[1] ?? null,
    remaining: visible.length,
    stats,
    rate,
  };
}
