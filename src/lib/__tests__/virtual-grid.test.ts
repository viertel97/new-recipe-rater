import { describe, it, expect } from "vitest";
import { rowCountFor, rowItemRange, prefixOffsets, visibleRowRange } from "@/lib/virtual-grid";

describe("rowCountFor", () => {
  it("ceil-divides items by columns", () => {
    expect(rowCountFor(0, 3)).toBe(0);
    expect(rowCountFor(7, 3)).toBe(3);
    expect(rowCountFor(6, 3)).toBe(2);
    expect(rowCountFor(1, 3)).toBe(1);
  });
  it("returns 0 for non-positive columns", () => {
    expect(rowCountFor(10, 0)).toBe(0);
  });
});

describe("rowItemRange", () => {
  it("returns [start, end) clamped to itemCount", () => {
    expect(rowItemRange(0, 3, 7)).toEqual([0, 3]);
    expect(rowItemRange(2, 3, 7)).toEqual([6, 7]);
  });
});

describe("prefixOffsets", () => {
  it("builds cumulative offsets with a trailing total", () => {
    expect(prefixOffsets([])).toEqual([0]);
    expect(prefixOffsets([100, 200, 50])).toEqual([0, 100, 300, 350]);
  });
});

describe("visibleRowRange", () => {
  const prefix = prefixOffsets([100, 100, 100, 100, 100]); // 5 rows, 500 tall

  it("returns [0,0] when no rows", () => {
    expect(visibleRowRange([0], 0, 800, 0)).toEqual([0, 0]);
  });
  it("includes rows intersecting the viewport at top with no overscan", () => {
    expect(visibleRowRange(prefix, 0, 250, 0)).toEqual([0, 3]);
  });
  it("scrolls the window down", () => {
    expect(visibleRowRange(prefix, 220, 100, 0)).toEqual([2, 4]);
  });
  it("applies overscan in px on both edges", () => {
    expect(visibleRowRange(prefix, 220, 100, 120)).toEqual([1, 5]);
  });
  it("clamps to the last row", () => {
    expect(visibleRowRange(prefix, 10000, 800, 0)).toEqual([5, 5]);
  });
});
