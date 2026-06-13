import { z } from "zod";

export const COLLECTION_TTL_MS = 24 * 60 * 60 * 1000;

export const createCollectionSchema = z.object({
  linkIds: z.array(z.string().min(1)).min(1).max(200),
});

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function hoursUntil(expiresAt: Date, now: Date = new Date()): number {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (60 * 60 * 1000));
}
