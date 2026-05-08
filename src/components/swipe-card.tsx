"use client";

import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { type LinkItem, type Category, type MediaAsset } from "@/types/link";
import { MediaCache, type CachedMedia } from "@/lib/media-cache";

export type SwipeCardHandle = {
  triggerSwipe: (direction: "left" | "right") => void;
};

const categoryColors: Record<Category, string> = {
  DINNER: "oklch(0.65 0.14 45)",
  SNACK: "oklch(0.70 0.12 75)",
  CAKE: "oklch(0.70 0.14 350)",
  BREAKFAST: "oklch(0.75 0.12 90)",
};

const categoryLabels: Record<Category, string> = {
  DINNER: "Dinner",
  SNACK: "Snack",
  CAKE: "Cake",
  BREAKFAST: "Breakfast",
};

const SWIPE_THRESHOLD = 0.3;
const MAX_ROTATION = 15;
const ROTATION_FACTOR = 0.06;

type MediaState =
  | { type: "loading" }
  | { type: "video"; videoUrl: string; thumbnail?: string }
  | { type: "image"; image: string | null; title: string | null; siteName: string | null }
  | { type: "error" };

function mediaAssetToState(asset: MediaAsset): MediaState {
  if (asset.type === "VIDEO") {
    return {
      type: "video",
      videoUrl: asset.blobUrl,
      thumbnail: asset.thumbnailUrl ?? undefined,
    };
  }
  return { type: "image", image: asset.blobUrl, title: asset.title, siteName: null };
}

function useCardMedia(link: LinkItem): MediaState {
  // If server already resolved media, use it directly — no client fetch needed
  const initialState: MediaState = link.mediaAsset
    ? mediaAssetToState(link.mediaAsset)
    : { type: "loading" };

  const [state, setState] = useState<MediaState>(initialState);

  useEffect(() => {
    // Already have resolved media from server
    if (link.mediaAsset) return;

    let cancelled = false;
    setState({ type: "loading" });
    MediaCache.get(link).then((cached: CachedMedia) => {
      if (cancelled) return;
      if (!cached) return setState({ type: "error" });
      if (cached.type === "video") {
        return setState({ type: "video", videoUrl: cached.videoUrl, thumbnail: cached.thumbnail });
      }
      setState({
        type: "image",
        image: cached.ogData.image,
        title: cached.ogData.title,
        siteName: cached.ogData.siteName,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [link]);

  return state;
}

export const SwipeCard = forwardRef<SwipeCardHandle, {
  link: LinkItem;
  onSwipe: (direction: "left" | "right") => void;
  onNavigate?: (direction: "prev" | "next") => void;
  active: boolean;
  hasPrev?: boolean;
}>(function SwipeCard({ link, onSwipe, onNavigate, active, hasPrev }, ref) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const navFiredRef = useRef(false);
  const [deltaX, setDeltaX] = useState(0);
  const [flying, setFlying] = useState<"left" | "right" | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressSeekingRef = useRef(false);
  // Sync imperative video.muted with React state — fixes stale-read bug
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);
  const media = useCardMedia(link);

  useEffect(() => {
    setVideoProgress(0);
    setVideoDuration(0);
  }, [media]);

  const screenWidth = typeof window !== "undefined" ? window.innerWidth : 400;
  const threshold = screenWidth * SWIPE_THRESHOLD;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active || flying) return;
    dragging.current = true;
    navFiredRef.current = false;
    startX.current = e.clientX;
    startY.current = e.clientY;
    currentX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [active, flying]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    currentX.current = e.clientX;
    setDeltaX(currentX.current - startX.current);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const dx = currentX.current - startX.current;
    const dy = e.clientY - startY.current;

    // Tap detection (minimal movement)
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && onNavigate) {
      const tapX = startX.current;
      const w = typeof window !== "undefined" ? window.innerWidth : 400;
      if (tapX < w * 0.35) {
        navFiredRef.current = true;
        setDeltaX(0);
        onNavigate("prev");
        return;
      }
      if (tapX > w * 0.65) {
        navFiredRef.current = true;
        setDeltaX(0);
        onNavigate("next");
        return;
      }
    }

    if (Math.abs(dx) > threshold) {
      const direction = dx > 0 ? "right" : "left";
      setFlying(direction);
      setTimeout(() => onSwipe(direction), 300);
    } else {
      setDeltaX(0);
    }
  }, [threshold, onSwipe, onNavigate]);

  const triggerSwipe = useCallback((direction: "left" | "right") => {
    setFlying(direction);
    setTimeout(() => onSwipe(direction), 300);
  }, [onSwipe]);

  useImperativeHandle(ref, () => ({ triggerSwipe }), [triggerSwipe]);

  const isNonVideoCard = media.type === "image" || media.type === "error";

  // Control video playback imperatively — back card stays paused until promoted
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active && playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [active, playing, media]); // media dep: re-run when video element mounts after async load

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
      onPointerCancel={(e) => handlePointerUp(e)}
    >
      {/* Background layer */}
      <div className="absolute inset-0 bg-background overflow-hidden">
        {media.type === "video" && (
          <video
            ref={videoRef}
            src={media.videoUrl}
            poster={media.thumbnail}
            muted={muted}
            playsInline
            loop
            className="w-full h-full object-cover"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (navFiredRef.current) { navFiredRef.current = false; return; } setPlaying((p) => !p); }}
            onTimeUpdate={() => {
              const v = videoRef.current;
              if (v && v.duration > 0) setVideoProgress(v.currentTime / v.duration);
            }}
            onLoadedMetadata={() => {
              if (videoRef.current) setVideoDuration(videoRef.current.duration);
            }}
          />
        )}
        {media.type === "image" && media.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.image}
            alt={media.title || ""}
            className="w-full h-full object-cover"
          />
        )}
        {media.type === "image" && !media.image && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              className="w-16 h-16 rounded-xl opacity-60"
            />
            <p className="text-sm text-muted-foreground font-medium">{domain}</p>
            {media.title && (
              <p className="text-lg font-semibold text-foreground text-center px-8 line-clamp-3">{media.title}</p>
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

      {/* Navigation tap-zone hints */}
      {active && onNavigate && (
        <>
          {hasPrev && (
            <div className="absolute left-0 top-0 bottom-0 w-12 z-[6] flex items-center justify-start pl-2 pointer-events-none">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-5 h-5 opacity-30">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </div>
          )}
          <div className="absolute right-0 top-0 bottom-0 w-12 z-[6] flex items-center justify-end pr-2 pointer-events-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-5 h-5 opacity-30">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </>
      )}

      {/* Gradient overlay */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "50%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
        }}
      />

      {/* Video progress bar — sits above the action buttons */}
      {media.type === "video" && videoDuration > 0 && (
        <div
          className="absolute left-4 right-4 z-20"
          style={{ bottom: "calc(max(24px, env(safe-area-inset-bottom)) + 80px)", height: 20, paddingBottom: 6 }}
          onPointerDown={(e) => {
            e.stopPropagation();
            progressSeekingRef.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (videoRef.current) videoRef.current.currentTime = ratio * videoDuration;
          }}
          onPointerMove={(e) => {
            if (!progressSeekingRef.current) return;
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (videoRef.current) videoRef.current.currentTime = ratio * videoDuration;
          }}
          onPointerUp={(e) => { e.stopPropagation(); progressSeekingRef.current = false; }}
          onPointerCancel={(e) => { e.stopPropagation(); progressSeekingRef.current = false; }}
        >
          <div className="w-full h-[3px] bg-white/20 rounded-full relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-white/80 rounded-full"
              style={{ width: `${videoProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Top-right controls */}
      <div className="absolute top-16 right-4 z-20 flex flex-col gap-2">
        {media.type === "image" && (
          <div
            className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
            aria-label="Image"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
        {media.type === "video" && (
          <button
            className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            aria-label={muted ? "Unmute" : "Mute"}
          >
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
          </button>
        )}
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Open link"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>

      {/* Recipe info overlay */}
      <div className="absolute bottom-20 left-0 right-0 px-5 z-10 pointer-events-none">
        {link.category && (
          <span
            className="inline-block text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded-full mb-2"
            style={{
              background: `color-mix(in oklch, ${categoryColors[link.category]} 20%, transparent)`,
              color: categoryColors[link.category],
              border: `1px solid color-mix(in oklch, ${categoryColors[link.category]} 30%, transparent)`,
            }}
          >
            {categoryLabels[link.category]}
          </span>
        )}
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/50 font-medium mb-1">{domain}</p>
        <p className="text-base font-semibold text-white line-clamp-2 leading-snug">
          {(media.type === "image" && media.title) || link.url}
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
