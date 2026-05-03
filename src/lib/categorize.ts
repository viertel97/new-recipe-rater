import Groq from "groq-sdk";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { extractMeta, extractTitleTag } from "@/lib/og";

export type Category = "DINNER" | "SNACK" | "CAKE" | "BREAKFAST";

const CategorySchema = z.object({
  category: z.enum(["DINNER", "SNACK", "CAKE", "BREAKFAST"]),
  reason: z.string(),
});

const SYSTEM_PROMPT = `You classify recipe links into exactly one of four categories:

- DINNER: full main meals — pasta, stews, roasts, rice bowls, casseroles, savory mains
- SNACK: small bites between meals — chips, dips, finger food, small savory or sweet snacks
- CAKE: cakes, tarts, cookies, sweet baked desserts, pastries
- BREAKFAST: morning food — porridge, oatmeal, pancakes, granola, smoothie bowls, eggs as breakfast

Pick the single best fit. If ambiguous, prefer the most likely use case for the dish.
Respond with strict JSON: {"category": "...", "reason": "one short sentence"}.`;

type Signals = {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
};

async function fetchSignals(url: string): Promise<Signals> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    return {
      url,
      title:
        extractMeta(html, "og:title") ||
        extractMeta(html, "twitter:title") ||
        extractTitleTag(html),
      description:
        extractMeta(html, "og:description") ||
        extractMeta(html, "twitter:description"),
      siteName: extractMeta(html, "og:site_name"),
    };
  } catch {
    return { url, title: null, description: null, siteName: null };
  }
}

function buildUserMessage(s: Signals): string {
  const parts = [
    `URL: ${s.url}`,
    s.siteName ? `Site: ${s.siteName}` : null,
    s.title ? `Title: ${s.title}` : null,
    s.description ? `Description: ${s.description}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

let _client: Groq | null = null;
function client(): Groq {
  if (!_client) _client = new Groq();
  return _client;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: ["DINNER", "SNACK", "CAKE", "BREAKFAST"],
    },
    reason: { type: "string" },
  },
  required: ["category", "reason"],
  additionalProperties: false,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    return msg.includes("429") || msg.includes("rate_limit_exceeded");
  }
  return false;
}

export async function classify(
  signals: Signals
): Promise<{ category: Category; reason: string }> {
  let retries = 0;
  while (true) {
    try {
      const completion = await client().chat.completions.create({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(signals) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "recipe_category",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        } as any,
        temperature: 0,
        max_tokens: 256,
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error("Groq returned empty response");
      const parsed = CategorySchema.parse(JSON.parse(raw));
      return parsed;
    } catch (err) {
      if (isRateLimit(err) && retries < 3) {
        retries++;
        const delay = retries * 8_000; // 8s, 16s, 24s
        console.log(`[categorize] Rate limited; retrying in ${delay}ms (attempt ${retries})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

const MAX_ATTEMPTS = 3;

export async function categorizeLink(linkId: string): Promise<void> {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) {
    console.error(`[categorize] Link ${linkId} not found`);
    return;
  }
  if (link.categoryStatus === "DONE") return;
  if (link.categoryAttempts >= MAX_ATTEMPTS) {
    await prisma.link.update({
      where: { id: linkId },
      data: { categoryStatus: "FAILED" },
    });
    return;
  }

  try {
    const signals = await fetchSignals(link.url);
    const { category } = await classify(signals);
    await prisma.link.update({
      where: { id: linkId },
      data: {
        category,
        categoryStatus: "DONE",
        categoryError: null,
        categoryAttempts: { increment: 1 },
      },
    });
    console.log(`[categorize] ${linkId} -> ${category}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[categorize] ${linkId} failed: ${message}`);
    await prisma.link.update({
      where: { id: linkId },
      data: {
        categoryError: message.slice(0, 500),
        categoryAttempts: { increment: 1 },
      },
    });
  }
}
