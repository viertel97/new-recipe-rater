import { describe, it, expect } from "vitest";
import { searchLinks } from "@/lib/search-links";
import type { LinkItem } from "@/types/link";

function makeLink(partial: Partial<LinkItem> & { id: string }): LinkItem {
  return {
    url: "https://example.com",
    rating: "PENDING",
    urgency: null,
    notes: null,
    reviewNote: null,
    tandoorRecipeId: null,
    category: null,
    categoryStatus: "DONE",
    createdAt: new Date("2026-01-01"),
    submittedById: "u1",
    submittedBy: { name: "Alice", email: null },
    mediaAsset: null,
    mediaStatus: "PENDING",
    ...partial,
  };
}

describe("searchLinks", () => {
  it("returns all links for empty query", () => {
    const links = [makeLink({ id: "a" }), makeLink({ id: "b" })];
    expect(searchLinks(links, "")).toHaveLength(2);
  });

  it("returns all links for whitespace-only query", () => {
    const links = [makeLink({ id: "a" }), makeLink({ id: "b" })];
    expect(searchLinks(links, "   ")).toHaveLength(2);
  });

  it("matches url case-insensitively", () => {
    const links = [
      makeLink({ id: "a", url: "https://instagram.com/p/abc" }),
      makeLink({ id: "b", url: "https://tiktok.com/v/xyz" }),
    ];
    expect(searchLinks(links, "INSTAGRAM")).toEqual([links[0]]);
  });

  it("matches notes", () => {
    const links = [
      makeLink({ id: "a", notes: "Pasta recipe from Italy" }),
      makeLink({ id: "b", notes: "Chocolate cake" }),
    ];
    expect(searchLinks(links, "pasta")).toEqual([links[0]]);
  });

  it("matches reviewNote", () => {
    const links = [
      makeLink({ id: "a", reviewNote: "Too spicy for kids" }),
      makeLink({ id: "b", reviewNote: null }),
    ];
    expect(searchLinks(links, "spicy")).toEqual([links[0]]);
  });

  it("handles null notes and reviewNote without throwing", () => {
    const links = [makeLink({ id: "a", notes: null, reviewNote: null })];
    expect(searchLinks(links, "anything")).toHaveLength(0);
  });

  it("returns multiple matches", () => {
    const links = [
      makeLink({ id: "a", notes: "chicken pasta" }),
      makeLink({ id: "b", notes: "chicken soup" }),
      makeLink({ id: "c", notes: "cake" }),
    ];
    expect(searchLinks(links, "chicken")).toHaveLength(2);
  });

  it("matches across fields — url matches even when notes does not", () => {
    const link = makeLink({
      id: "a",
      url: "https://instagram.com/p/abc123",
      notes: "chocolate cake",
    });
    expect(searchLinks([link], "instagram")).toEqual([link]);
  });
});
