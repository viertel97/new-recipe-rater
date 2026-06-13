"use client";

import { useMemo, useState } from "react";
import { LinkCard } from "@/components/link-card";
import { type LinkItem, type Category, type Urgency } from "@/types/link";
import { searchLinks } from "@/lib/search-links";

/* ── Filter configs ─────────────────────────────────────────────── */

const RATING_OPTIONS = ["PENDING", "GOOD", "BAD"] as const;
type RatingOpt = (typeof RATING_OPTIONS)[number];

const RATING_META: Record<RatingOpt, { label: string; color: string }> = {
  PENDING: { label: "Pending", color: "oklch(0.82 0.14 65)" },
  GOOD: { label: "Good", color: "oklch(0.70 0.15 145)" },
  BAD: { label: "Bad", color: "oklch(0.75 0.15 20)" },
};

const CATEGORY_OPTIONS: Category[] = ["DINNER", "SNACK", "CAKE", "BREAKFAST"];

const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  DINNER: { label: "Dinner", color: "oklch(0.65 0.14 45)" },
  SNACK: { label: "Snack", color: "oklch(0.70 0.12 75)" },
  CAKE: { label: "Cake", color: "oklch(0.70 0.14 350)" },
  BREAKFAST: { label: "Breakfast", color: "oklch(0.75 0.12 90)" },
};

const URGENCY_OPTIONS: Urgency[] = ["TOMORROW", "NEXT_WEEK", "NEXT_MONTH", "ARCHIVE"];

const URGENCY_META: Record<Urgency, { label: string; color: string }> = {
  TOMORROW: { label: "Tomorrow", color: "oklch(0.70 0.18 30)" },
  NEXT_WEEK: { label: "Next week", color: "oklch(0.75 0.14 65)" },
  NEXT_MONTH: { label: "Next month", color: "oklch(0.70 0.12 220)" },
  ARCHIVE: { label: "Archive", color: "oklch(0.55 0.03 260)" },
};

/* ── Helpers ────────────────────────────────────────────────────── */

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function activeCount(
  ratings: Set<RatingOpt>,
  categories: Set<Category>,
  urgencies: Set<Urgency>,
  tandoor: boolean
): number {
  let count = 0;
  if (ratings.size) count += ratings.size;
  if (categories.size) count += categories.size;
  if (urgencies.size) count += urgencies.size;
  if (tandoor) count += 1;
  return count;
}

function FilterChip<T extends string>({
  label,
  count,
  selected,
  onClick,
  color,
  size = "md",
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  color: string;
  size?: "md" | "sm";
}) {
  const base =
    size === "sm"
      ? "px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wide border transition-all duration-200"
      : "px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide border transition-all duration-200";

  if (selected) {
    return (
      <button
        onClick={onClick}
        className={base}
        style={{
          borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
          background: `color-mix(in oklch, ${color} 14%, transparent)`,
          color,
        }}
      >
        {label}
        <span className="ml-1.5 opacity-70">{count}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`${base} text-muted-foreground/70 hover:text-muted-foreground border-transparent hover:border-border/30`}
    >
      {label}
      <span className="ml-1.5 opacity-50">{count}</span>
    </button>
  );
}

/* ── Dashboard ──────────────────────────────────────────────────── */

export function Dashboard({
  links,
  currentUserId,
  tandoorUrl,
}: {
  links: LinkItem[];
  currentUserId: string;
  tandoorUrl?: string;
}) {
  const [ratings, setRatings] = useState<Set<RatingOpt>>(new Set());
  const [categories, setCategories] = useState<Set<Category>>(new Set());
  const [urgencies, setUrgencies] = useState<Set<Urgency>>(new Set());
  const [tandoorOnly, setTandoorOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  /* ── Filtering ── */
  const searchedLinks = useMemo(
    () => searchLinks(links, searchQuery),
    [links, searchQuery],
  );

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

  /* ── Dynamic counts (computed against other active filters) ── */
  const ratingCounts = useMemo(() => {
    const counts: Record<RatingOpt, number> = { PENDING: 0, GOOD: 0, BAD: 0 };
    for (const l of searchedLinks) {
      // apply all filters EXCEPT ratings
      if (categories.size > 0 && (!l.category || !categories.has(l.category))) continue;
      if (urgencies.size > 0 && (!l.urgency || !urgencies.has(l.urgency))) continue;
      if (tandoorOnly && l.tandoorRecipeId == null) continue;
      if (counts[l.rating as RatingOpt] !== undefined) {
        counts[l.rating as RatingOpt]++;
      }
    }
    return counts;
  }, [searchedLinks, categories, urgencies, tandoorOnly]);

  const categoryCounts = useMemo(() => {
    const counts: Record<Category, number> = { DINNER: 0, SNACK: 0, CAKE: 0, BREAKFAST: 0 };
    for (const l of searchedLinks) {
      if (!l.category) continue;
      // apply all filters EXCEPT categories
      if (ratings.size > 0 && !ratings.has(l.rating as RatingOpt)) continue;
      if (urgencies.size > 0 && (!l.urgency || !urgencies.has(l.urgency))) continue;
      if (tandoorOnly && l.tandoorRecipeId == null) continue;
      counts[l.category]++;
    }
    return counts;
  }, [searchedLinks, ratings, urgencies, tandoorOnly]);

  const urgencyCounts = useMemo(() => {
    const counts: Record<Urgency, number> = { TOMORROW: 0, NEXT_WEEK: 0, NEXT_MONTH: 0, ARCHIVE: 0 };
    for (const l of searchedLinks) {
      if (!l.urgency) continue;
      // apply all filters EXCEPT urgencies
      if (ratings.size > 0 && !ratings.has(l.rating as RatingOpt)) continue;
      if (categories.size > 0 && (!l.category || !categories.has(l.category))) continue;
      if (tandoorOnly && l.tandoorRecipeId == null) continue;
      counts[l.urgency]++;
    }
    return counts;
  }, [searchedLinks, ratings, categories, tandoorOnly]);

  const tandoorCount = useMemo(() => {
    let count = 0;
    for (const l of searchedLinks) {
      if (ratings.size > 0 && !ratings.has(l.rating as RatingOpt)) continue;
      if (categories.size > 0 && (!l.category || !categories.has(l.category))) continue;
      if (urgencies.size > 0 && (!l.urgency || !urgencies.has(l.urgency))) continue;
      if (l.tandoorRecipeId != null) count++;
    }
    return count;
  }, [searchedLinks, ratings, categories, urgencies]);

  const hasActiveFilters =
    activeCount(ratings, categories, urgencies, tandoorOnly) > 0 ||
    searchQuery.trim() !== "";

  return (
    <div className="space-y-5">
      {/* ── Filter bar ── */}
      <div className="glass-card rounded-xl overflow-hidden">
        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes, URL…"
            className="w-full bg-background/50 border border-border/60 rounded-lg px-3 py-2 text-sm outline-none focus:border-border placeholder:text-muted-foreground/40"
          />
        </div>
        {/* Toggle header */}
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <p className="text-[11px] uppercase tracking-[0.15em] font-semibold text-muted-foreground/60">
            Filters
            {hasActiveFilters && (
              <span className="ml-2 text-coral">· {filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            )}
            {!filtersOpen && !hasActiveFilters && (
              <span className="ml-2 opacity-40">{links.length}</span>
            )}
          </p>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="w-4 h-4 text-muted-foreground/40 transition-transform duration-200"
            style={{ transform: filtersOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {filtersOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-border/20">
            {/* Rating */}
            <div className="pt-3">
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/40 mb-1.5">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {RATING_OPTIONS.map((r) => (
                  <FilterChip
                    key={r}
                    label={RATING_META[r].label}
                    count={ratingCounts[r]}
                    selected={ratings.has(r)}
                    onClick={() => setRatings((s) => toggle(s, r))}
                    color={RATING_META[r].color}
                    size="sm"
                  />
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/40 mb-1.5">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((c) => (
                  <FilterChip
                    key={c}
                    label={CATEGORY_META[c].label}
                    count={categoryCounts[c]}
                    selected={categories.has(c)}
                    onClick={() => setCategories((s) => toggle(s, c))}
                    color={CATEGORY_META[c].color}
                    size="sm"
                  />
                ))}
              </div>
            </div>

            {/* Urgency */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/40 mb-1.5">When to make</p>
              <div className="flex flex-wrap gap-1.5">
                {URGENCY_OPTIONS.map((u) => (
                  <FilterChip
                    key={u}
                    label={URGENCY_META[u].label}
                    count={urgencyCounts[u]}
                    selected={urgencies.has(u)}
                    onClick={() => setUrgencies((s) => toggle(s, u))}
                    color={URGENCY_META[u].color}
                    size="sm"
                  />
                ))}
              </div>
            </div>

            {/* Tandoor + reset row */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/40 mb-1.5">Location</p>
                <FilterChip
                  label="In Tandoor"
                  count={tandoorCount}
                  selected={tandoorOnly}
                  onClick={() => setTandoorOnly((v) => !v)}
                  color="oklch(0.65 0.12 145)"
                  size="sm"
                />
              </div>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setRatings(new Set());
                    setCategories(new Set());
                    setUrgencies(new Set());
                    setTandoorOnly(false);
                    setSearchQuery("");
                  }}
                  className="text-[11px] font-medium text-muted-foreground/60 hover:text-red-400 transition-colors self-end pb-0.5"
                >
                  Reset all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Cards grid ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="text-4xl mb-3 opacity-30">
            {ratings.has("GOOD") && !ratings.has("BAD") && !ratings.has("PENDING")
              ? "+"
              : ratings.has("BAD") && !ratings.has("GOOD") && !ratings.has("PENDING")
                ? "-"
                : "~"}
          </div>
          <p className="text-muted-foreground text-sm">
            {!hasActiveFilters ? "No links submitted yet" : "No recipes match your filters"}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((link, i) => (
            <div
              key={link.id}
              className="animate-card-enter"
              style={{
                animationDelay: `${Math.min(i, 12) * 60}ms`,
                contentVisibility: "auto",
                containIntrinsicSize: "auto 420px",
              }}
            >
              <LinkCard link={link} canReview={true} tandoorUrl={tandoorUrl} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
