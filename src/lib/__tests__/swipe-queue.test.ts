import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSwipeQueue } from "@/lib/swipe-queue";
import type { LinkItem } from "@/types/link";

vi.mock("@/lib/actions", () => ({
  rateLink: vi.fn().mockResolvedValue({ success: true }),
}));

function makeLink(id: string, category: LinkItem["category"] = null): LinkItem {
  return {
    id,
    url: `https://example.com/${id}`,
    rating: "PENDING",
    urgency: null,
    notes: null,
    reviewNote: null,
    tandoorRecipeId: null,
    category,
    categoryStatus: "DONE",
    createdAt: new Date("2026-01-01"),
    submittedById: "u1",
    submittedBy: { name: "Alice", email: null },
  };
}

const noFilter = { categories: [], includeUncategorized: true };

describe("useSwipeQueue", () => {
  it("snapshots initialLinks on first mount and ignores later prop updates", () => {
    const A = makeLink("A"), B = makeLink("B"), C = makeLink("C"), D = makeLink("D");
    const { result, rerender } = renderHook(
      ({ links }) => useSwipeQueue(links, noFilter),
      { initialProps: { links: [A, B, C, D] } }
    );

    expect(result.current.active?.id).toBe("A");
    expect(result.current.next?.id).toBe("B");

    // Server revalidation arrives with reordered/filtered list — hook must ignore it
    rerender({ links: [B, C, D] });
    expect(result.current.active?.id).toBe("A");
    expect(result.current.next?.id).toBe("B");
  });

  it("filters by categories when provided", () => {
    const dinner = makeLink("d", "DINNER");
    const snack = makeLink("s", "SNACK");
    const cake = makeLink("c", "CAKE");
    const { result } = renderHook(() =>
      useSwipeQueue([dinner, snack, cake], {
        categories: ["DINNER", "CAKE"],
        includeUncategorized: false,
      })
    );

    expect(result.current.active?.id).toBe("d");
    expect(result.current.next?.id).toBe("c");
    expect(result.current.remaining).toBe(2);
  });

  it("includeUncategorized=true with empty categories shows everything", () => {
    const dinner = makeLink("d", "DINNER");
    const uncat = makeLink("u", null);
    const { result } = renderHook(() =>
      useSwipeQueue([dinner, uncat], { categories: [], includeUncategorized: true })
    );

    expect(result.current.remaining).toBe(2);
  });

  it("includeUncategorized=false with empty categories shows nothing", () => {
    const dinner = makeLink("d", "DINNER");
    const uncat = makeLink("u", null);
    const { result } = renderHook(() =>
      useSwipeQueue([dinner, uncat], { categories: [], includeUncategorized: false })
    );

    expect(result.current.remaining).toBe(0);
    expect(result.current.active).toBeNull();
  });

  it("includes uncategorized when toggle is on alongside category filter", () => {
    const dinner = makeLink("d", "DINNER");
    const uncat = makeLink("u", null);
    const snack = makeLink("s", "SNACK");
    const { result } = renderHook(() =>
      useSwipeQueue([dinner, uncat, snack], {
        categories: ["DINNER"],
        includeUncategorized: true,
      })
    );

    expect(result.current.remaining).toBe(2);
    expect(result.current.active?.id).toBe("d");
    expect(result.current.next?.id).toBe("u");
  });

  it("rate() advances the visible queue and updates stats", () => {
    const A = makeLink("A"), B = makeLink("B"), C = makeLink("C");
    const { result } = renderHook(() => useSwipeQueue([A, B, C], noFilter));

    expect(result.current.active?.id).toBe("A");

    act(() => {
      result.current.rate("A", "GOOD");
    });

    expect(result.current.active?.id).toBe("B");
    expect(result.current.next?.id).toBe("C");
    expect(result.current.stats.liked).toBe(1);
    expect(result.current.remaining).toBe(2);

    act(() => {
      result.current.rate("B", "BAD");
    });

    expect(result.current.active?.id).toBe("C");
    expect(result.current.next).toBeNull();
    expect(result.current.stats.noped).toBe(1);
  });

  it("calls rateLink server action with correct args", async () => {
    const { rateLink } = await import("@/lib/actions");
    const A = makeLink("A");
    const { result } = renderHook(() => useSwipeQueue([A], noFilter));

    act(() => {
      result.current.rate("A", "GOOD", { urgency: "NEXT_WEEK" });
    });

    expect(rateLink).toHaveBeenCalledWith("A", "GOOD", { urgency: "NEXT_WEEK" });
  });

  it("rate() is idempotent on duplicate id", () => {
    const A = makeLink("A"), B = makeLink("B");
    const { result } = renderHook(() => useSwipeQueue([A, B], noFilter));

    act(() => {
      result.current.rate("A", "GOOD");
      result.current.rate("A", "GOOD");
    });

    expect(result.current.stats.liked).toBe(1);
    expect(result.current.active?.id).toBe("B");
  });
});
