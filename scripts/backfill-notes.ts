import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

function extractMeta(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?)(?:property|name)=["']${property}["'][^>]*?content=["']([^"']*?)["']|<meta\\s+(?:[^>]*?)content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(regex);
  return match ? match[1] || match[2] || null : null;
}

async function getOgDescription(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  const html = await res.text();
  return (
    extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description") ||
    null
  );
}

async function scrapeInstagramDescription(url: string): Promise<string | null> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessKey) return null;

  const { chromium } = await import("playwright-core");
  const browser = await chromium.connect(
    `wss://production-sfo.browserless.io/chromium/playwright?token=${browserlessKey}&launch={"args":["--disable-blink-features=AutomationControlled"]}`,
  );
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      // Dismiss cookie banner
      try {
        await page
          .locator("button:has-text('Allow all cookies'), button:has-text('Alle Cookies erlauben')")
          .first()
          .click({ timeout: 5_000 });
      } catch {}
      await page.waitForTimeout(1_000);
      // Expand caption
      try {
        await page.locator("span[role='link']:has-text('more')").first().click({ timeout: 5_000 });
        await page.waitForTimeout(1_000);
      } catch {}

      for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(1_000);
        const result = await page.evaluate(() => {
          const descriptions: string[] = [];
          for (const s of ["meta[property='og:description']", "meta[property='twitter:description']"]) {
            const el = document.querySelector(s) as HTMLMetaElement | null;
            if (el?.content) descriptions.push(el.content);
          }
          const h1 = document.querySelector("h1");
          if (h1?.textContent && h1.textContent.length > 50) descriptions.push(h1.textContent);
          const article = document.querySelector("article");
          if (article) {
            const spans = article.querySelectorAll("span");
            let longest = "";
            spans.forEach((s) => {
              const t = s.textContent || "";
              if (t.length > longest.length) longest = t;
            });
            if (longest.length > 50) descriptions.push(longest);
          }
          descriptions.sort((a, b) => b.length - a.length);
          return descriptions[0] || null;
        });
        if (result) return result;
      }
      return null;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
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

      if (isInstagramUrl(link.url)) {
        if (!process.env.BROWSERLESS_API_KEY) {
          console.log("SKIP (no BROWSERLESS_API_KEY)");
          skipped++;
          continue;
        }
        description = await scrapeInstagramDescription(link.url);
      } else if (link.mediaAsset?.description) {
        description = link.mediaAsset.description;
      } else {
        description = await getOgDescription(link.url);
      }

      if (description) {
        await prisma.link.update({
          where: { id: link.id },
          data: { notes: description.slice(0, 500) },
        });
        console.log(`OK — "${description.slice(0, 60)}"`);
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
