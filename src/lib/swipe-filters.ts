"use client";

import { useState, useCallback, useEffect } from "react";
import { type Category } from "@/types/link";
import { type SwipeFilters } from "@/lib/swipe-queue";

const STORAGE_KEY = "swipe.filters";

const DEFAULT: SwipeFilters = { categories: [], includeUncategorized: true };

function load(): SwipeFilters {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    return JSON.parse(raw) as SwipeFilters;
  } catch {
    return DEFAULT;
  }
}

export function useSwipeFilters() {
  const [filters, setFilters] = useState<SwipeFilters>(DEFAULT);

  // Load from localStorage after hydration
  useEffect(() => {
    setFilters(load());
  }, []);

  const apply = useCallback((next: SwipeFilters) => {
    setFilters(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const reset = useCallback(() => apply(DEFAULT), [apply]);

  const activeCount = filters.categories.length + (filters.includeUncategorized ? 0 : 1);

  return { filters, apply, reset, activeCount };
}

export const ALL_CATEGORIES: { value: Category; label: string; emoji: string }[] = [
  { value: "DINNER", label: "Dinner", emoji: "🍽️" },
  { value: "SNACK", label: "Snack", emoji: "🥨" },
  { value: "CAKE", label: "Cake", emoji: "🎂" },
  { value: "BREAKFAST", label: "Breakfast", emoji: "🥞" },
];
