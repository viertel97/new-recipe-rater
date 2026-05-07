"use client";

import { useRef, useCallback } from "react";

export function BottomSheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dragStartY = useRef(0);
  const dragging = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.clientY - dragStartY.current > 80) onClose();
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-30">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute bottom-0 left-0 right-0 animate-sheet-up rounded-t-2xl overflow-hidden"
        style={{ background: "oklch(0.17 0.005 250)" }}
      >
        <div
          className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>
        {children}
      </div>
    </div>
  );
}
