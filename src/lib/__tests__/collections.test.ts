import { describe, it, expect } from "vitest";
import {
  COLLECTION_TTL_MS,
  createCollectionSchema,
  isExpired,
  hoursUntil,
} from "@/lib/collections";

describe("collections helpers", () => {
  it("TTL is 24 hours in ms", () => {
    expect(COLLECTION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("validates link id lists: non-empty, capped at 200", () => {
    expect(createCollectionSchema.safeParse({ linkIds: ["a", "b"] }).success).toBe(true);
    expect(createCollectionSchema.safeParse({ linkIds: [] }).success).toBe(false);
    expect(createCollectionSchema.safeParse({ linkIds: [""] }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, i) => `id${i}`);
    expect(createCollectionSchema.safeParse({ linkIds: tooMany }).success).toBe(false);
  });

  it("isExpired is true at or after expiry, false before", () => {
    const now = new Date("2026-06-13T12:00:00Z");
    expect(isExpired(new Date("2026-06-13T11:59:59Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-06-13T12:00:00Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-06-13T12:00:01Z"), now)).toBe(false);
  });

  it("hoursUntil rounds up and floors at 0", () => {
    const now = new Date("2026-06-13T12:00:00Z");
    expect(hoursUntil(new Date("2026-06-14T12:00:00Z"), now)).toBe(24);
    expect(hoursUntil(new Date("2026-06-13T12:30:00Z"), now)).toBe(1); // 0.5h rounds up
    expect(hoursUntil(new Date("2026-06-13T11:00:00Z"), now)).toBe(0); // past
  });
});
