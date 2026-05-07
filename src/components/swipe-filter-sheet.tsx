"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ALL_CATEGORIES, type useSwipeFilters } from "@/lib/swipe-filters";
import { type SwipeFilters } from "@/lib/swipe-queue";
import { type Category } from "@/types/link";

type Props = {
  current: SwipeFilters;
  onApply: ReturnType<typeof useSwipeFilters>["apply"];
  onReset: ReturnType<typeof useSwipeFilters>["reset"];
  onClose: () => void;
};

export function SwipeFilterSheet({ current, onApply, onReset, onClose }: Props) {
  const [categories, setCategories] = useState<Category[]>(current.categories);
  const [includeUncategorized, setIncludeUncategorized] = useState(current.includeUncategorized);

  function toggleCategory(cat: Category) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function handleApply() {
    onApply({ categories, includeUncategorized });
    onClose();
  }

  function handleReset() {
    onReset();
    onClose();
  }

  const chipBase = "flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-medium transition-all active:scale-95";

  return (
    <BottomSheet onClose={onClose}>
      <div className="px-6 pb-8">
        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-4">
          Filter by category
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {ALL_CATEGORIES.map((cat) => {
            const active = categories.includes(cat.value);
            return (
              <button
                key={cat.value}
                onClick={() => toggleCategory(cat.value)}
                className={chipBase}
                style={active ? {
                  background: "oklch(0.55 0.15 145 / 15%)",
                  borderColor: "oklch(0.55 0.15 145 / 50%)",
                  color: "oklch(0.55 0.15 145)",
                } : {
                  background: "transparent",
                  borderColor: "oklch(1 0 0 / 15%)",
                  color: "oklch(0.7 0 0)",
                }}
              >
                <span>{cat.emoji}</span>
                {cat.label}
              </button>
            );
          })}
          <button
            onClick={() => setIncludeUncategorized((v) => !v)}
            className={chipBase}
            style={includeUncategorized ? {
              background: "oklch(0.55 0.15 145 / 15%)",
              borderColor: "oklch(0.55 0.15 145 / 50%)",
              color: "oklch(0.55 0.15 145)",
            } : {
              background: "transparent",
              borderColor: "oklch(1 0 0 / 15%)",
              color: "oklch(0.7 0 0)",
            }}
          >
            <span>❓</span>
            Uncategorized
          </button>
        </div>

        <div className="flex gap-3 mt-2">
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl border border-border/40 text-sm text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors active:scale-95"
            style={{ background: "oklch(0.55 0.15 145)" }}
          >
            Apply
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
