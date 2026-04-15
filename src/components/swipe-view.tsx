"use client";

import { type LinkItem } from "@/types/link";

export function SwipeView({ links }: { links: LinkItem[] }) {
  return (
    <div className="h-dvh bg-background flex items-center justify-center">
      <p className="text-muted-foreground">SwipeView placeholder — {links.length} pending</p>
    </div>
  );
}
