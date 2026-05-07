"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "installPrompt.dismissedAt";
const RE_SHOW_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < RE_SHOW_AFTER_MS) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!prompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-border/40 bg-card/90 backdrop-blur-md px-4 py-3 shadow-lg">
      <span className="text-2xl">🍽️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Install Recipe Rater</p>
        <p className="text-xs text-muted-foreground">Add to your home screen</p>
      </div>
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, String(Date.now()));
          setPrompt(null);
        }}
        className="text-xs text-muted-foreground/60 px-2 py-1"
      >
        Not now
      </button>
      <button
        onClick={async () => {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === "accepted") {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
          }
          setPrompt(null);
        }}
        className="text-xs font-semibold px-3 py-1.5 rounded-xl"
        style={{ background: "oklch(0.55 0.15 145)", color: "white" }}
      >
        Install
      </button>
    </div>
  );
}
