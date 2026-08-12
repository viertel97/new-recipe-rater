"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { submitLinkSchema, rateLinkSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { Rating, Urgency, Category } from "@/generated/prisma/client";
import { scheduleMediaResolution } from "@/lib/media-resolver";
import { evictMediaForLink } from "@/lib/media-store";
import { cleanInstagramDescription } from "@/lib/utils";
import { aiImportText, createTandoorRecipe, uploadTandoorImage } from "@/lib/tandoor";
import { createCollectionSchema, COLLECTION_TTL_MS, isExpired, hoursUntil } from "@/lib/collections";
import type { SharedCollectionView } from "@/types/link";

const SOCIAL_MEDIA_DOMAINS = new Set([
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
]);

function isSocialMediaUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return SOCIAL_MEDIA_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

export async function submitLink(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const parsed = submitLinkSchema.safeParse({
    url: formData.get("url"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const existing = await prisma.link.findFirst({
    where: { url: parsed.data.url },
  });
  if (existing) {
    return { error: "This link has already been submitted" };
  }

  const link = await prisma.link.create({
    data: {
      url: parsed.data.url,
      submittedById: session.user.id,
    },
  });

  scheduleMediaResolution(link.id);

  revalidatePath("/");
  return { success: true };
}

export async function importToTandoor(linkId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Link not found" };
  if (link.rating !== "GOOD") return { error: "Only GOOD-rated links can be imported" };

  const tandoorUrl = process.env.TANDOOR_URL;
  const tandoorToken = process.env.TANDOOR_TOKEN;
  if (!tandoorUrl || !tandoorToken) return { error: "Tandoor is not configured" };

  // Presence checked above; helpers read TANDOOR_* from env themselves.
  if (isSocialMediaUrl(link.url)) {
    return importSocialMediaToTandoor(linkId, link.url);
  } else {
    return importGenericToTandoor(linkId, link.url);
  }
}

async function importSocialMediaToTandoor(linkId: string, url: string) {
  // Scrape the post using a headless browser (like kitshn's WebView)
  const { scrapeSocialMediaPost } = await import("@/lib/scrape-social");
  const scraped = await scrapeSocialMediaPost(url);

  console.log("[importSocialMedia] Scraped result:", {
    description: scraped.description?.substring(0, 100),
    imageURL: scraped.imageURL?.substring(0, 100),
  });

  if (!scraped.description || scraped.description.length < 3) {
    return { error: "Could not extract post content" };
  }

  // Clean up OG description: strip the "X likes, Y comments - user on date: " prefix
  const recipeText = cleanInstagramDescription(scraped.description);

  try {
    console.log("[importSocialMedia] Sending to Tandoor:", {
      textLength: recipeText.length,
      textPreview: recipeText.substring(0, 200),
    });

    const recipe = await aiImportText(recipeText);
    console.log("[importSocialMedia] AI parse response:", {
      recipeName: recipe.name,
      stepsCount: recipe.steps?.length,
    });

    const { id } = await createTandoorRecipe(recipe, url);
    console.log("[importSocialMedia] Recipe create response:", { id, name: recipe.name });

    await prisma.link.update({
      where: { id: linkId },
      data: { tandoorRecipeId: id },
    });

    if (scraped.imageURL) {
      await uploadTandoorImage(id, scraped.imageURL);
    }

    revalidatePath("/");
    return { success: true, tandoorRecipeId: id };
  } catch (e) {
    console.error("[importSocialMedia] Error:", e);
    return { error: e instanceof Error ? e.message : "Failed to connect to Tandoor" };
  }
}

async function importGenericToTandoor(linkId: string, url: string) {
  const { extractRecipeFromHtml } = await import("@/lib/web-recipe");

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
    });
    console.log("[importGeneric] Fetch status:", res.status);
    html = await res.text();
  } catch {
    return { error: "Failed to fetch recipe page" };
  }

  try {
    const extracted = extractRecipeFromHtml(url, html);
    console.log("[importGeneric] Extracted:", {
      jsonLd: extracted.structured !== null,
      textLength: extracted.text.length,
      imageUrl: extracted.imageUrl?.substring(0, 100),
    });

    let recipe;
    if (extracted.structured) {
      recipe = extracted.structured;
    } else if (extracted.text.trim().length > 0) {
      recipe = await aiImportText(extracted.text);
    } else {
      return { error: "Could not extract a recipe from this page" };
    }
    console.log("[importGeneric] Recipe name:", recipe.name);

    const { id } = await createTandoorRecipe(recipe, url);
    console.log("[importGeneric] Created recipe id:", id);

    await prisma.link.update({
      where: { id: linkId },
      data: { tandoorRecipeId: id },
    });

    if (extracted.imageUrl) {
      await uploadTandoorImage(id, extracted.imageUrl);
    }

    revalidatePath("/");
    return { success: true, tandoorRecipeId: id };
  } catch (e) {
    console.error("[importGeneric] Error:", e);
    return { error: e instanceof Error ? e.message : "Failed to connect to Tandoor" };
  }
}

export async function resetRating(linkId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  if (!linkId || typeof linkId !== "string") {
    return { error: "Invalid link ID" };
  }

  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Link not found" };

  await prisma.link.update({
    where: { id: linkId },
    data: {
      rating: "PENDING" as Rating,
      urgency: null,
      reviewNote: null,
    },
  });

  revalidatePath("/");
  return { success: true };
}

export async function rateLink(
  linkId: string,
  rating: "GOOD" | "BAD",
  options?: { urgency?: "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE"; reviewNote?: string }
) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const parsed = rateLinkSchema.safeParse({
    linkId,
    rating,
    urgency: options?.urgency,
    reviewNote: options?.reviewNote,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Link not found" };

  await prisma.link.update({
    where: { id: linkId },
    data: {
      rating: rating as Rating,
      urgency: (parsed.data.urgency as Urgency) ?? null,
      reviewNote: parsed.data.reviewNote ?? null,
    },
  });

  // Best-effort eviction — don't let failure block the rating
  evictMediaForLink(linkId).catch((err) =>
    console.error(`[rateLink] eviction failed for ${linkId}:`, err)
  );

  revalidatePath("/");
  return { success: true };
}

export async function setCategory(
  linkId: string,
  category: "DINNER" | "SNACK" | "CAKE" | "BREAKFAST"
) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  await prisma.link.update({
    where: { id: linkId },
    data: {
      category: category as Category,
      categoryStatus: "DONE",
      categoryError: null,
    },
  });

  return { success: true };
}

export async function createSharedCollection(
  linkIds: string[]
): Promise<{ token: string } | { error: string }> {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const parsed = createCollectionSchema.safeParse({ linkIds });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Keep only ids that actually exist.
  const existing = await prisma.link.findMany({
    where: { id: { in: parsed.data.linkIds } },
    select: { id: true },
  });
  const validIds = existing.map((l) => l.id);
  if (validIds.length === 0) {
    return { error: "No valid recipes selected" };
  }

  const collection = await prisma.sharedCollection.create({
    data: {
      linkIds: validIds,
      createdById: session.user.id,
      expiresAt: new Date(Date.now() + COLLECTION_TTL_MS),
    },
  });

  return { token: collection.id };
}

export async function getSharedCollection(
  token: string
): Promise<SharedCollectionView | null> {
  if (!token) return null;

  const collection = await prisma.sharedCollection.findUnique({
    where: { id: token },
  });

  if (!collection || isExpired(collection.expiresAt)) {
    // Best-effort opportunistic cleanup of expired rows; never block the read.
    prisma.sharedCollection
      .deleteMany({ where: { expiresAt: { lte: new Date() } } })
      .catch((err) => console.error("[getSharedCollection] cleanup failed:", err));
    return null;
  }

  return {
    token: collection.id,
    linkIds: collection.linkIds,
    expiresAt: collection.expiresAt,
    hoursLeft: hoursUntil(collection.expiresAt),
  };
}
