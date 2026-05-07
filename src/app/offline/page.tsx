"use client";

export default function OfflinePage() {
  return (
    <div className="h-dvh flex flex-col items-center justify-center text-center px-8 gap-4">
      <div className="text-5xl opacity-80">📡</div>
      <p className="text-base font-semibold text-foreground/80">You&apos;re offline</p>
      <p className="text-xs text-muted-foreground/50 leading-relaxed max-w-[240px]">
        Check your connection and try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-6 py-2.5 rounded-xl text-xs font-medium border border-border/60 text-muted-foreground/60 hover:text-foreground transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
