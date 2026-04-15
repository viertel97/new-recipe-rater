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
