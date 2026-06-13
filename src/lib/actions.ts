"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { submitLinkSchema, rateLinkSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { Rating, Urgency, Category } from "@/generated/prisma/client";
import { scheduleMediaResolution } from "@/lib/media-resolver";
import { evictMediaForLink } from "@/lib/media-store";
import { cleanInstagramDescription } from "@/lib/utils";
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

  if (isSocialMediaUrl(link.url)) {
    return importSocialMediaToTandoor(linkId, link.url, tandoorUrl, tandoorToken);
  } else {
    return importBookmarkletToTandoor(linkId, link.url, tandoorUrl, tandoorToken);
  }
}

async function importSocialMediaToTandoor(
  linkId: string,
  url: string,
  tandoorUrl: string,
  tandoorToken: string
) {
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
  let recipeText = cleanInstagramDescription(scraped.description);

  // Send to Tandoor AI import
  try {
    const aiProviderId = process.env.TANDOOR_AI_PROVIDER_ID;

    console.log("[importSocialMedia] Sending to Tandoor:", {
      textLength: recipeText.length,
      textPreview: recipeText.substring(0, 200),
      aiProviderId: aiProviderId || "default",
    });

    const formData = new FormData();
    formData.append("recipe_id", "");
    formData.append("text", recipeText);
    formData.append("file", new Blob([]), "");
    if (aiProviderId) {
      formData.append("ai_provider_id", aiProviderId);
    }

    const res = await fetch(`${tandoorUrl}/api/ai-import/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tandoorToken}`,
      },
      body: formData,
    });

    const aiData = await res.json();

    console.log("[importSocialMedia] AI parse response:", {
      status: res.status,
      error: aiData.error,
      recipeName: aiData.recipe?.name,
      stepsCount: aiData.recipe?.steps?.length,
      msg: aiData.msg?.substring(0, 200),
    });

    if (!res.ok || aiData.error || !aiData.recipe) {
      return { error: aiData.msg || `Tandoor AI import failed (${res.status})` };
    }

    // Step 2: Create the recipe in Tandoor (ai-import only parses, doesn't save)
    const recipePayload = {
      ...aiData.recipe,
      source_url: url,
      servings: aiData.recipe.servings ?? 1,
    };

    const createRes = await fetch(`${tandoorUrl}/api/recipe/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tandoorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(recipePayload),
    });

    const createdRecipe = await createRes.json();

    console.log("[importSocialMedia] Recipe create response:", {
      status: createRes.status,
      id: createdRecipe.id,
      name: createdRecipe.name,
    });

    if (!createRes.ok) {
      return { error: `Failed to create recipe (${createRes.status}): ${JSON.stringify(createdRecipe).substring(0, 200)}` };
    }

    // Save Tandoor recipe ID to database
    await prisma.link.update({
      where: { id: linkId },
      data: { tandoorRecipeId: createdRecipe.id },
    });

    // Step 3: Upload recipe image via PUT /api/recipe/{id}/image/ (like kitshn does)
    if (scraped.imageURL) {
      try {
        const imageForm = new FormData();
        imageForm.append("image_url", scraped.imageURL);

        const imgRes = await fetch(`${tandoorUrl}/api/recipe/${createdRecipe.id}/image/`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tandoorToken}`,
          },
          body: imageForm,
        });

        console.log("[importSocialMedia] Image upload response:", {
          status: imgRes.status,
        });
      } catch (imgErr) {
        console.error("[importSocialMedia] Image upload failed (non-fatal):", imgErr);
      }
    }

    revalidatePath("/");
    return {
      success: true,
      tandoorRecipeId: createdRecipe.id,
    };
  } catch (e) {
    console.error("[importSocialMedia] Error:", e);
    return { error: "Failed to connect to Tandoor" };
  }
}

async function importBookmarkletToTandoor(
  linkId: string,
  url: string,
  tandoorUrl: string,
  tandoorToken: string
) {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeRater/1.0)" },
    });
    html = await res.text();
  } catch {
    return { error: "Failed to fetch recipe page" };
  }

  try {
    const res = await fetch(`${tandoorUrl}/api/bookmarklet-import/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tandoorToken}`,
      },
      body: JSON.stringify({ url, html }),
    });

    if (res.status !== 201) {
      return { error: `Tandoor import failed (${res.status})` };
    }

    const data = await res.json();
    return {
      success: true,
      importUrl: `${tandoorUrl}/recipe/import/?bookmarklet_import=${data.id}`,
    };
  } catch {
    return { error: "Failed to connect to Tandoor" };
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
