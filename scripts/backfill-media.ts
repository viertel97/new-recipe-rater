/**
 * Backfill media assets for all PENDING links with mediaStatus PENDING or FAILED.
 * Safe to re-run — resolveMediaForLink is idempotent.
 *
 * Usage: npx tsx scripts/backfill-media.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveMediaForLink } from "../src/lib/media-store";

const prisma = new PrismaClient();
const MAX_CONCURRENT = 2;

async function main() {
  const links = await prisma.link.findMany({
    where: {
      rating: "PENDING",
      mediaStatus: { in: ["PENDING", "FAILED"] },
    },
    select: { id: true, url: true, mediaStatus: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[backfill] ${links.length} links to resolve`);

  let done = 0;
  let i = 0;

  async function worker() {
    while (i < links.length) {
      const link = links[i++];
      try {
        const asset = await resolveMediaForLink(link.id);
        done++;
        console.log(`[backfill] ${done}/${links.length} ${asset ? "resolved" : "failed"} ${link.url}`);
      } catch (err) {
        console.error(`[backfill] error for ${link.url}:`, err);
      }
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  console.log(`[backfill] done. ${done} resolved.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
