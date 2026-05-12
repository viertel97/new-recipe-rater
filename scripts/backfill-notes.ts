import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { scrapeSocialMediaPost } from "../src/lib/scrape-social.js";
import { cleanInstagramDescription } from "../src/lib/utils.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const SOCIAL_MEDIA_DOMAINS = new Set([
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
]);

function isSocialMediaUrl(url: string): boolean {
  try {
    return SOCIAL_MEDIA_DOMAINS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function main() {
  const links = await prisma.link.findMany({
    where: { notes: null },
    include: { mediaAsset: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${links.length} links without notes`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const link of links) {
    process.stdout.write(`[${link.id}] ${link.url.slice(0, 60)}… `);

    try {
      let description: string | null = null;

      if (isSocialMediaUrl(link.url)) {
        if (!process.env.BROWSERLESS_API_KEY) {
          console.log("SKIP (no BROWSERLESS_API_KEY)");
          skipped++;
          continue;
        }
        const scraped = await scrapeSocialMediaPost(link.url);
        description = scraped.description ? cleanInstagramDescription(scraped.description) : null;
      } else if (link.mediaAsset?.description) {
        description = link.mediaAsset.description;
      }

      if (description) {
        await prisma.link.update({
          where: { id: link.id },
          data: { notes: description },
        });
        console.log(`OK — "${description.slice(0, 80)}"`);
        updated++;
      } else {
        console.log("SKIP (no description found)");
        skipped++;
      }
    } catch (err) {
      console.log(`FAIL — ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
