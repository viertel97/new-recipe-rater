import { chromium, type Browser } from "playwright";

export type ScrapeResult = {
  description: string | null;
  imageURL: string | null;
};

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return browserPromise;
}

/**
 * Dismiss Instagram popups: cookie consent + "Never miss a post" login modal.
 */
async function dismissInstagramPopups(page: import("playwright").Page) {
  // Cookie consent — "Allow all cookies"
  try {
    await page
      .locator("button:has-text('Allow all cookies'), button:has-text('Alle Cookies erlauben')")
      .first()
      .click({ timeout: 5000 });
    console.log("[scrape-social] Dismissed cookie banner");
  } catch {
    // No cookie banner
  }

  await page.waitForTimeout(1000);

  // "Never miss a post" login modal — the Close is a div[role=button] not a <button>
  try {
    await page
      .locator("[role='dialog'] div[role='button']:has-text('Close'), [role='dialog'] svg[aria-label='Close']")
      .first()
      .click({ timeout: 3000 });
    console.log("[scrape-social] Dismissed login modal");
  } catch {
    // No modal
  }

  await page.waitForTimeout(1000);
}

/**
 * Scrapes a social media post using a headless browser.
 * Dismisses Instagram popups, clicks "more" to expand caption,
 * then extracts the full text (like kitshn's WebView).
 */
export async function scrapeSocialMediaPost(
  url: string
): Promise<ScrapeResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("[scrape-social] Navigating to:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Dismiss popups that block content
    if (url.includes("instagram.com")) {
      await dismissInstagramPopups(page);

      // Click "more" to expand truncated caption
      try {
        await page
          .locator("span[role='link']:has-text('more')")
          .first()
          .click({ timeout: 5000 });
        console.log("[scrape-social] Expanded caption with 'more' click");
        await page.waitForTimeout(1000);
      } catch {
        console.log("[scrape-social] No 'more' button found");
      }
    }

    let result: ScrapeResult = { description: null, imageURL: null };

    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(1000);

      result = await page.evaluate(() => {
        const descriptions: string[] = [];

        // Try OG meta tags
        const ogSelectors = [
          "meta[property='og:description']",
          "meta[property='twitter:description']",
          "meta[property='og:title']",
        ];
        for (const s of ogSelectors) {
          const el = document.querySelector(s) as HTMLMetaElement | null;
          if (el?.content) descriptions.push(el.content);
        }

        // For Instagram: get the visible caption text from the DOM (longer than OG tag)
        if (window.location.hostname.includes("instagram")) {
          // Caption is typically in an h1 element or a span inside the article
          const h1 = document.querySelector("h1");
          if (h1?.textContent && h1.textContent.length > 50) {
            descriptions.push(h1.textContent);
          }

          // Also try: longest span inside an article element
          const article = document.querySelector("article");
          if (article) {
            const spans = article.querySelectorAll("span");
            let longest = "";
            spans.forEach((s) => {
              const text = s.textContent || "";
              if (text.length > longest.length) longest = text;
            });
            if (longest.length > 50) {
              descriptions.push(longest);
            }
          }
        }

        // Pick the longest description (most complete caption)
        descriptions.sort((a, b) => b.length - a.length);

        let imageURL: string | null = null;
        try {
          if (window.location.hostname.includes("tiktok")) {
            const pic = document.querySelector("picture");
            if (pic) {
              const img = pic.querySelector("img") as HTMLImageElement | null;
              if (img?.src) imageURL = img.src;
            }
          } else if (window.location.hostname.includes("instagram")) {
            const vid = document.getElementsByTagName("video")[0];
            if (vid) {
              const container =
                vid.parentElement?.parentElement?.parentElement?.parentElement;
              const img = container?.querySelector(
                "img"
              ) as HTMLImageElement | null;
              if (img?.src) imageURL = img.src;
            }
          }
        } catch {
          // ignore
        }

        if (!imageURL) {
          const ogImage = document.querySelector(
            "meta[property='og:image']"
          ) as HTMLMetaElement | null;
          if (ogImage?.content) imageURL = ogImage.content;
        }

        return {
          description: descriptions[0] || null,
          descriptionLength: descriptions[0]?.length || 0,
          imageURL: imageURL && imageURL.length > 3 ? imageURL : null,
        } as { description: string | null; descriptionLength: number; imageURL: string | null };
      });

      console.log(
        `[scrape-social] Attempt ${attempt + 1}: desc_length=${(result as any).descriptionLength}, preview=${result.description ? result.description.substring(0, 80) + "..." : "null"}`
      );

      if (result.description) break;

      if (attempt === 0) {
        const debug = await page.evaluate(() => ({
          title: document.title,
          url: window.location.href,
          bodyText: document.body?.innerText?.substring(0, 200),
        }));
        console.log("[scrape-social] Page state:", JSON.stringify(debug));
      }

      // Try dismissing popups again in case they appeared late
      if (attempt === 2 && url.includes("instagram.com")) {
        await dismissInstagramPopups(page);
      }
    }

    console.log("[scrape-social] Final result:", {
      descriptionLength: result.description?.length,
      descriptionPreview: result.description?.substring(0, 200),
      imageURL: result.imageURL?.substring(0, 100),
    });

    return { description: result.description, imageURL: result.imageURL };
  } finally {
    await context.close();
  }
}
