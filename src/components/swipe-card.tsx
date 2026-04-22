"use client";

import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { type LinkItem, type OgData } from "@/types/link";

export type SwipeCardHandle = {
  triggerSwipe: (direction: "left" | "right") => void;
};

const SWIPE_THRESHOLD = 0.3; // 30% of screen width
const MAX_ROTATION = 15; // degrees
const ROTATION_FACTOR = 0.06;

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

type MediaData =
  | { type: "video"; videoUrl: string; thumbnail?: string }
  | { type: "image"; ogData: OgData }
  | { type: "loading" }
  | { type: "error" };

function useMediaData(url: string): MediaData {
  const [data, setData] = useState<MediaData>({ type: "loading" });

  useEffect(() => {
    let cancelled = false;

    if (isInstagramUrl(url)) {
      fetch(`/api/instagram?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((json) => {
          if (cancelled) return;
          const media = json.media?.[0];
          if (media?.type === "video") {
            setData({ type: "video", videoUrl: media.url, thumbnail: media.thumbnail });
          } else if (media?.url) {
            setData({ type: "image", ogData: { title: null, image: media.url, description: null, siteName: "Instagram" } });
          } else {
            setData({ type: "error" });
          }
        })
        .catch(() => !cancelled && setData({ type: "error" }));
    } else {
      fetch(`/api/og?url=${encodeURIComponent(url)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((ogData) => !cancelled && setData({ type: "image", ogData }))
        .catch(() => !cancelled && setData({ type: "error" }));
    }

    return () => { cancelled = true; };
  }, [url]);

  return data;
}

export const SwipeCard = forwardRef<SwipeCardHandle, {
  link: LinkItem;
  onSwipe: (direction: "left" | "right") => void;
  active: boolean;
}>(function SwipeCard({ link, onSwipe, active }, ref) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const currentX = useRef(0);
  const [deltaX, setDeltaX] = useState(0);
  const [flying, setFlying] = useState<"left" | "right" | null>(null);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = useMediaData(link.url);

  const screenWidth = typeof window !== "undefined" ? window.innerWidth : 400;
  const threshold = screenWidth * SWIPE_THRESHOLD;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active || flying) return;
    dragging.current = true;
    startX.current = e.clientX;
    currentX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [active, flying]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    currentX.current = e.clientX;
    setDeltaX(currentX.current - startX.current);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const dx = currentX.current - startX.current;

    if (Math.abs(dx) > threshold) {
      const direction = dx > 0 ? "right" : "left";
      setFlying(direction);
      setTimeout(() => onSwipe(direction), 300);
    } else {
      setDeltaX(0);
    }
  }, [threshold, onSwipe]);

  const triggerSwipe = useCallback((direction: "left" | "right") => {
    setFlying(direction);
    setTimeout(() => onSwipe(direction), 300);
  }, [onSwipe]);

  useImperativeHandle(ref, () => ({ triggerSwipe }), [triggerSwipe]);

  const isNonVideoCard = media.type === "image" || media.type === "error";

  const rotation = Math.min(MAX_ROTATION, Math.max(-MAX_ROTATION, deltaX * ROTATION_FACTOR));
  const stampOpacity = Math.min(1, Math.abs(deltaX) / threshold);
  const isRight = deltaX > 0;

  const flyX = flying === "right" ? screenWidth * 1.5 : flying === "left" ? -screenWidth * 1.5 : 0;
  const flyRotation = flying ? (flying === "right" ? MAX_ROTATION : -MAX_ROTATION) : 0;

  const domain = (() => {
    try { return new URL(link.url).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  })();

  const submitterName = link.submittedBy.name || link.submittedBy.email || "Unknown";
  const dateStr = new Date(link.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div
      ref={cardRef}
      className="absolute inset-0 touch-none select-none"
      style={{
        transform: flying
          ? `translateX(${flyX}px) rotate(${flyRotation}deg)`
          : `translateX(${deltaX}px) rotate(${rotation}deg)`,
        transition: flying
          ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
          : dragging.current
            ? "none"
            : "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        opacity: flying ? 0 : 1,
        zIndex: active ? 10 : 0,
        pointerEvents: active ? "auto" : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Background layer */}
      <div className="absolute inset-0 bg-background overflow-hidden">
        {media.type === "video" && (
          <video
            ref={videoRef}
            src={media.videoUrl}
            poster={media.thumbnail}
            autoPlay
            muted={muted}
            playsInline
            loop
            className="w-full h-full object-cover"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
              if (videoRef.current) videoRef.current.muted = !muted;
            }}
          />
        )}
        {media.type === "image" && media.ogData.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.ogData.image}
            alt={media.ogData.title || ""}
            className="w-full h-full object-cover"
          />
        )}
        {media.type === "image" && !media.ogData.image && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              className="w-16 h-16 rounded-xl opacity-60"
            />
            <p className="text-sm text-muted-foreground font-medium">{domain}</p>
            {media.ogData.title && (
              <p className="text-lg font-semibold text-foreground text-center px-8 line-clamp-3">{media.ogData.title}</p>
            )}
          </div>
        )}
        {media.type === "loading" && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-muted-foreground/40 text-sm">Loading...</div>
          </div>
        )}
        {media.type === "error" && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <p className="text-muted-foreground/60 text-sm">Could not load media</p>
            <p className="text-xs text-muted-foreground/40">{domain}</p>
          </div>
        )}
      </div>

      {/* Color overlay (green/red tint proportional to drag) */}
      {deltaX !== 0 && !flying && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: isRight
              ? `oklch(0.55 0.15 145 / ${stampOpacity * 0.15})`
              : `oklch(0.65 0.2 20 / ${stampOpacity * 0.15})`,
          }}
        />
      )}

      {/* Tap-to-open for non-video cards */}
      {isNonVideoCard && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 z-5"
          onClick={(e) => {
            // Only open link on tap, not after drag
            if (Math.abs(deltaX) > 5) e.preventDefault();
          }}
        />
      )}

      {/* Gradient overlay */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "50%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
        }}
      />

      {/* Mute indicator */}
      {media.type === "video" && (
        <div className="absolute top-4 right-4 z-20 pointer-events-none">
          <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            {muted ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Recipe info overlay */}
      <div className="absolute bottom-20 left-0 right-0 px-5 z-10 pointer-events-none">
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/50 font-medium mb-1">{domain}</p>
        <p className="text-base font-semibold text-white line-clamp-2 leading-snug">
          {(media.type === "image" && media.ogData.title) || link.url}
        </p>
        <p className="text-xs text-white/40 mt-1.5">
          {submitterName} · {dateStr}
        </p>
      </div>

      {/* LIKE stamp */}
      <div
        className="absolute top-20 left-6 z-20 pointer-events-none"
        style={{ opacity: isRight ? stampOpacity : 0 }}
      >
        <span className="swipe-stamp" style={{ color: "oklch(0.55 0.15 145)", borderColor: "oklch(0.55 0.15 145)" }}>
          LIKE
        </span>
      </div>

      {/* NOPE stamp */}
      <div
        className="absolute top-20 right-6 z-20 pointer-events-none"
        style={{ opacity: !isRight ? stampOpacity : 0, transform: "rotate(12deg)" }}
      >
        <span className="swipe-stamp" style={{ color: "oklch(0.65 0.2 20)", borderColor: "oklch(0.65 0.2 20)" }}>
          NOPE
        </span>
      </div>
    </div>
  );
});
