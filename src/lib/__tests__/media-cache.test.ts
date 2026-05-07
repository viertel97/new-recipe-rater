import { describe, it, expect, beforeEach, vi } from "vitest";
import { MediaCache } from "@/lib/media-cache";
import type { LinkItem } from "@/types/link";

function makeLink(id: string, url: string): LinkItem {
  return {
    id,
    url,
    rating: "PENDING",
    urgency: null,
    notes: null,
    reviewNote: null,
    tandoorRecipeId: null,
    category: null,
    categoryStatus: "DONE",
    createdAt: new Date("2026-01-01"),
    submittedById: "u1",
    submittedBy: { name: null, email: null },
  };
}

describe("MediaCache", () => {
  beforeEach(() => {
    MediaCache._reset();
    vi.restoreAllMocks();
  });

  it("dedups concurrent calls for the same link", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ media: [{ url: "https://cdn/x.mp4", type: "video" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const link = makeLink("L1", "https://instagram.com/p/abc/");
    const [a, b] = await Promise.all([MediaCache.get(link), MediaCache.get(link)]);

    expect(a).toEqual(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches the resolved value for subsequent calls", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "T", image: null, description: null, siteName: null }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const link = makeLink("L2", "https://example.com/recipe");
    await MediaCache.get(link);
    await MediaCache.get(link);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches null on fetch failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);

    const link = makeLink("L3", "https://example.com/x");
    const result = await MediaCache.get(link);

    expect(result).toBeNull();
    // Second call should not refetch
    await MediaCache.get(link);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("limits in-flight requests to 2", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchSpy = vi.fn().mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve({ ok: true, json: async () => ({ title: "x", image: null, description: null, siteName: null }) });
        }, 10)
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const links = Array.from({ length: 5 }, (_, i) => makeLink(`L${i}`, `https://example.com/${i}`));
    await Promise.all(links.map((l) => MediaCache.get(l)));

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
