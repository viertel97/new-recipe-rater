"use client";

import { useState, useOptimistic, useEffect, useCallback, startTransition } from "react";
import { createPortal } from "react-dom";
import { rateLink, importToTandoor } from "@/lib/actions";

type Urgency = "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE";

type LinkItem = {
  id: string;
  url: string;
  rating: "PENDING" | "GOOD" | "BAD";
  urgency: Urgency | null;
  notes: string | null;
  reviewNote: string | null;
  tandoorRecipeId: number | null;
  createdAt: Date;
  submittedById: string;
  submittedBy: { name: string | null; email: string | null };
};

function getPostId(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/);
  return match ? match[1] : null;
}

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}


type OgData = { title: string | null; image: string | null; description: string | null; siteName: string | null };

function OgPreview({ url }: { url: string }) {
  const [og, setOg] = useState<OgData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/og?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setOg(data))
      .catch(() => setOg(null))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) {
    return (
      <div className="aspect-video max-h-[300px] bg-background/30 flex items-center justify-center">
        <div className="text-muted-foreground/40 text-sm">Loading preview...</div>
      </div>
    );
  }

  if (!og?.image) {
    // Fallback: show domain with icon
    const domain = new URL(url).hostname.replace(/^www\./, "");
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 bg-background/30 hover:bg-background/40 transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          alt=""
          className="w-8 h-8 rounded"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{og?.title || domain}</p>
          {og?.description && (
            <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{og.description}</p>
          )}
        </div>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block relative aspect-video max-h-[300px] overflow-hidden bg-background/30 group"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={og.image}
        alt={og.title || ""}
        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
      />
      {(og.title || og.siteName) && (
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
          {og.siteName && (
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-0.5">{og.siteName}</p>
          )}
          {og.title && (
            <p className="text-sm font-medium text-white/90 line-clamp-2">{og.title}</p>
          )}
        </div>
      )}
    </a>
  );
}

type MediaItem = { url: string; thumbnail?: string; type: string };

function InstagramModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    fetch(`/api/instagram?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setMedia(data.media))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [url]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal content */}
      <div
        className="relative w-full max-w-[480px] animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm font-medium tracking-wide transition-colors z-10"
        >
          Close
        </button>

        <div className="rounded-xl overflow-hidden bg-black" style={{ maxHeight: "85vh" }}>
          {loading && (
            <div className="flex items-center justify-center h-64 text-white/50 text-sm">
              Loading...
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <p className="text-white/50 text-sm">Could not load media</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 text-sm hover:underline"
              >
                Open on Instagram
              </a>
            </div>
          )}
          {media && media.length > 0 && (
            <>
              {media[0].type === "video" ? (
                <video
                  src={media[0].url}
                  poster={media[0].thumbnail}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[85vh] object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={media[0].url}
                  alt=""
                  className="w-full max-h-[85vh] object-contain"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const urgencyConfig: Record<Urgency, { label: string; color: string }> = {
  TOMORROW: { label: "Tomorrow", color: "oklch(0.70 0.18 30)" },
  NEXT_WEEK: { label: "Next week", color: "oklch(0.75 0.14 65)" },
  NEXT_MONTH: { label: "Next month", color: "oklch(0.70 0.12 220)" },
  ARCHIVE: { label: "Archive", color: "oklch(0.55 0.03 260)" },
};

function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const c = urgencyConfig[urgency];
  return (
    <span
      className="inline-flex items-center text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `color-mix(in oklch, ${c.color} 12%, transparent)`, color: c.color }}
    >
      {c.label}
    </span>
  );
}

function RatingIndicator({ rating }: { rating: string }) {
  const config: Record<string, { bg: string; text: string; label: string; dot: string }> = {
    PENDING: {
      bg: "oklch(0.78 0.14 65 / 8%)",
      text: "oklch(0.82 0.14 65)",
      dot: "oklch(0.78 0.14 65)",
      label: "Pending",
    },
    GOOD: {
      bg: "oklch(0.55 0.15 145 / 10%)",
      text: "oklch(0.70 0.15 145)",
      dot: "oklch(0.55 0.15 145)",
      label: "Good",
    },
    BAD: {
      bg: "oklch(0.65 0.2 20 / 10%)",
      text: "oklch(0.75 0.15 20)",
      dot: "oklch(0.65 0.2 20)",
      label: "Bad",
    },
  };
  const c = config[rating] || config.PENDING;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: c.dot }}
      />
      {c.label}
    </span>
  );
}

export function LinkCard({ link, canReview, tandoorUrl }: { link: LinkItem; canReview: boolean; tandoorUrl?: string }) {
  const [optimisticRating, setOptimisticRating] = useOptimistic(link.rating);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [localTandoorRecipeId, setLocalTandoorRecipeId] = useState(link.tandoorRecipeId);
  const [selectedUrgency, setSelectedUrgency] = useState<Urgency | undefined>(link.urgency ?? undefined);
  const [reviewNote, setReviewNote] = useState(link.reviewNote ?? "");
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const isInsta = isInstagramUrl(link.url);
  const postId = isInsta ? getPostId(link.url) : null;
  const closeModal = useCallback(() => setModalOpen(false), []);

  async function handleRate(rating: "GOOD" | "BAD") {
    setLoading(true);
    startTransition(async () => {
      setOptimisticRating(rating);
      await rateLink(link.id, rating, {
        urgency: selectedUrgency,
        reviewNote: reviewNote.trim() || undefined,
      });
      setLoading(false);
      setExpanded(false);
    });
  }

  async function handleImportToTandoor() {
    setImporting(true);
    setImportStatus(null);
    const result = await importToTandoor(link.id);
    if ("error" in result) {
      setImportStatus(result.error);
    } else if ("tandoorRecipeId" in result) {
      setLocalTandoorRecipeId(result.tandoorRecipeId);
    } else if ("importUrl" in result) {
      window.open(result.importUrl, "_blank");
      setImportStatus("Sent to Tandoor");
    }
    setImporting(false);
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Preview — Instagram embed or OG thumbnail */}
      {isInsta && postId ? (
        <>
          <div
            className="relative aspect-square max-h-[400px] overflow-hidden bg-background/30 cursor-pointer group"
            onClick={() => {
              if (window.innerWidth < 768) {
                window.open(link.url, "_blank");
              } else {
                setModalOpen(true);
              }
            }}
          >
            <iframe
              src={`https://www.instagram.com/p/${postId}/embed/`}
              className="w-full h-full border-0 pointer-events-none"
              loading="lazy"
              tabIndex={-1}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-transparent group-hover:bg-black/20 transition-colors">
              <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity">
                <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>
          {modalOpen && (
            <InstagramModal url={link.url} onClose={closeModal} />
          )}
        </>
      ) : !isInsta ? (
        <OgPreview url={link.url} />
      ) : null}

      {/* Content */}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:opacity-70 transition-opacity truncate block"
              style={{ color: "oklch(0.75 0.12 25)" }}
            >
              {link.url}
            </a>
            {link.notes && (
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{link.notes}</p>
            )}
            <p className="text-[11px] text-muted-foreground/60 mt-2">
              {link.submittedBy.name || link.submittedBy.email || "Unknown"}
              <span className="mx-1.5 opacity-40">/</span>
              {new Date(link.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {link.urgency && <UrgencyBadge urgency={link.urgency} />}
            <RatingIndicator rating={optimisticRating} />
          </div>
        </div>

        {/* Review note display */}
        {link.reviewNote && optimisticRating !== "PENDING" && (
          <p className="text-xs text-muted-foreground/80 italic leading-relaxed">
            &ldquo;{link.reviewNote}&rdquo;
          </p>
        )}

        {/* Rating buttons */}
        {canReview && !expanded && optimisticRating === "PENDING" && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setExpanded(true)}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium tracking-wide
                border border-border/60 text-muted-foreground hover:text-foreground
                transition-all duration-200"
            >
              Rate this
            </button>
          </div>
        )}

        {/* Expanded rating form */}
        {canReview && expanded && (
          <div className="space-y-3 pt-1 animate-fade-in">
            {/* Urgency picker */}
            <div>
              <p className="text-[11px] text-muted-foreground/70 mb-1.5 uppercase tracking-widest font-medium">When to make</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(urgencyConfig) as Urgency[]).map((u) => {
                  const c = urgencyConfig[u];
                  const selected = selectedUrgency === u;
                  return (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setSelectedUrgency(selected ? undefined : u)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium tracking-wide border transition-all duration-200"
                      style={selected ? {
                        borderColor: `color-mix(in oklch, ${c.color} 40%, transparent)`,
                        background: `color-mix(in oklch, ${c.color} 12%, transparent)`,
                        color: c.color,
                      } : {
                        borderColor: 'color-mix(in oklch, currentColor 15%, transparent)',
                        color: 'inherit',
                        opacity: 0.6,
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Review note */}
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Add a note (optional)"
              maxLength={500}
              rows={2}
              className="w-full bg-background/40 border border-border/50 rounded-lg px-3 py-2
                text-xs text-foreground placeholder:text-muted-foreground/50
                focus:outline-none focus:border-border resize-none transition-colors"
            />

            {/* Rating buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => handleRate("GOOD")}
                disabled={loading}
                className="rating-btn rating-btn-good flex-1 px-3 py-2 rounded-lg text-xs font-medium tracking-wide
                  border border-green-500/30 bg-green-500/10 text-green-400
                  hover:bg-green-500/20 transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Good
              </button>
              <button
                onClick={() => handleRate("BAD")}
                disabled={loading}
                className="rating-btn rating-btn-bad flex-1 px-3 py-2 rounded-lg text-xs font-medium tracking-wide
                  border border-red-500/30 bg-red-500/10 text-red-400
                  hover:bg-red-500/20 transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Bad
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="px-3 py-2 rounded-lg text-xs font-medium tracking-wide
                  border border-border/40 text-muted-foreground/60
                  hover:text-muted-foreground transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Already rated - show compact info */}
        {canReview && optimisticRating !== "PENDING" && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setExpanded(true)}
              className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              Change rating
            </button>
          </div>
        )}

        {/* Import to Tandoor / View in Tandoor */}
        {optimisticRating === "GOOD" && (
          <div className="pt-1">
            {localTandoorRecipeId && tandoorUrl ? (
              <a
                href={`${tandoorUrl}/view/recipe/${localTandoorRecipeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-3 py-2 rounded-lg text-xs font-medium tracking-wide text-center
                  border border-green-500/30 bg-green-500/10 text-green-400
                  hover:bg-green-500/20 transition-all duration-200"
              >
                View in Tandoor
              </a>
            ) : (
              <button
                onClick={handleImportToTandoor}
                disabled={importing}
                className="w-full px-3 py-2 rounded-lg text-xs font-medium tracking-wide
                  border border-blue-500/30 bg-blue-500/10 text-blue-400
                  hover:bg-blue-500/20 transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {importing ? "Importing..." : "Import to Tandoor"}
              </button>
            )}
            {importStatus && (
              <p className={`text-[11px] mt-1.5 text-red-400`}>
                {importStatus}
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
