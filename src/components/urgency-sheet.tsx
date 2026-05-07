"use client";

import { type Urgency } from "@/types/link";
import { BottomSheet } from "@/components/ui/bottom-sheet";

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
  return (
    <BottomSheet onClose={onSkip}>
      <div className="px-6 pb-8">
        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-4">
          When to cook?
        </p>
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
        <button
          onClick={onSkip}
          className="w-full text-center mt-4 py-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          Skip
        </button>
      </div>
    </BottomSheet>
  );
}
