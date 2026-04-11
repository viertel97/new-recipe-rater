"use client";

import { useState } from "react";
import { LinkCard } from "@/components/link-card";

type LinkItem = {
  id: string;
  url: string;
  rating: "PENDING" | "GOOD" | "BAD";
  urgency: "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE" | null;
  notes: string | null;
  reviewNote: string | null;
  tandoorRecipeId: number | null;
  createdAt: Date;
  submittedById: string;
  submittedBy: { name: string | null; email: string | null };
};

const filters = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "GOOD", label: "Good" },
  { key: "BAD", label: "Bad" },
] as const;

export function Dashboard({ links, currentUserId, tandoorUrl }: { links: LinkItem[]; currentUserId: string; tandoorUrl?: string }) {
  const [filter, setFilter] = useState<string>("ALL");

  const filtered = filter === "ALL" ? links : links.filter((l) => l.rating === filter);

  const counts = {
    ALL: links.length,
    PENDING: links.filter((l) => l.rating === "PENDING").length,
    GOOD: links.filter((l) => l.rating === "GOOD").length,
    BAD: links.filter((l) => l.rating === "BAD").length,
  };

  return (
    <div className="space-y-6">
      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-xl w-fit">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`
              px-4 py-2 rounded-lg text-xs font-medium tracking-wide transition-all duration-200
              ${filter === f.key
                ? "bg-coral text-coral-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
              }
            `}
          >
            {f.label}
            <span className={`ml-1.5 ${filter === f.key ? "opacity-80" : "opacity-50"}`}>
              {counts[f.key as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="text-4xl mb-3 opacity-30">
            {filter === "GOOD" ? "+" : filter === "BAD" ? "-" : "~"}
          </div>
          <p className="text-muted-foreground text-sm">
            {filter === "ALL" ? "No links submitted yet" : `No ${filter.toLowerCase()} links`}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((link, i) => (
            <div
              key={link.id}
              className="animate-card-enter"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <LinkCard link={link} canReview={link.submittedById !== currentUserId} tandoorUrl={tandoorUrl} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
