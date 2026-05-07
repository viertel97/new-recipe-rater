import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { resolveMediaForLink } = await import("../src/lib/media-store");

  const links = await prisma.link.findMany({
    where: { mediaStatus: { in: ["PENDING", "FAILED"] } },
    select: { id: true, url: true, mediaStatus: true, rating: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[backfill] ${links.length} links to resolve`);
  if (links.length === 0) return;

  let done = 0;
  let i = 0;
  const MAX_CONCURRENT = 2;

  async function worker() {
    while (i < links.length) {
      const link = links[i++];
      try {
        const asset = await resolveMediaForLink(link.id, { force: true });
        done++;
        console.log(`[backfill] ${done}/${links.length} ${asset ? "✓" : "✗"} ${link.url}`);
      } catch (err) {
        console.error(`[backfill] error for ${link.url}:`, err);
      }
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  console.log(`[backfill] done.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
