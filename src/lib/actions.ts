"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { submitLinkSchema, rateLinkSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { Rating, Urgency } from "@/generated/prisma/client";

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
    notes: formData.get("notes") || undefined,
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

  await prisma.link.create({
    data: {
      url: parsed.data.url,
      notes: parsed.data.notes,
      submittedById: session.user.id,
    },
  });

  revalidatePath("/");
  return { success: true };
}

export async function importToTandoor(
  linkId: string,
  scraped?: { description: string; imageURL?: string }
) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Link not found" };
  if (link.rating !== "GOOD") return { error: "Only GOOD-rated links can be imported" };

  const tandoorUrl = process.env.TANDOOR_URL;
  const tandoorToken = process.env.TANDOOR_TOKEN;
  if (!tandoorUrl || !tandoorToken) return { error: "Tandoor is not configured" };

  if (isSocialMediaUrl(link.url) && scraped?.description) {
    return importSocialMediaToTandoor(scraped, tandoorUrl, tandoorToken);
  } else {
    return importBookmarkletToTandoor(link.url, tandoorUrl, tandoorToken);
  }
}

async function importSocialMediaToTandoor(
  scraped: { description: string; imageURL?: string },
  tandoorUrl: string,
  tandoorToken: string
) {
  if (scraped.description.length < 3) {
    return { error: "Could not extract post content" };
  }

  // Download cover image if available
  let imageBlob: Blob | null = null;
  if (scraped.imageURL) {
    try {
      const imgRes = await fetch(scraped.imageURL, { signal: AbortSignal.timeout(10000) });
      if (imgRes.ok) {
        imageBlob = await imgRes.blob();
      }
    } catch {
      // Proceed without image
    }
  }

  // Send to Tandoor AI import
  try {
    const formData = new FormData();
    formData.append("recipe_id", "");
    formData.append("text", scraped.description);

    if (imageBlob) {
      formData.append("file", imageBlob, "cover.jpg");
    } else {
      formData.append("file", "");
    }

    const aiProviderId = process.env.TANDOOR_AI_PROVIDER_ID;
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

    if (!res.ok) {
      const text = await res.text();
      return { error: `Tandoor AI import failed (${res.status}): ${text}` };
    }

    const data = await res.json();

    if (data.error) {
      return { error: data.msg || "Tandoor AI import failed" };
    }

    const recipeId = data.recipe_id ?? data.recipe?.id;
    if (recipeId) {
      return {
        success: true,
        importUrl: `${tandoorUrl}/view/recipe/${recipeId}`,
      };
    }

    return { success: true, importUrl: tandoorUrl };
  } catch {
    return { error: "Failed to connect to Tandoor" };
  }
}

async function importBookmarkletToTandoor(
  url: string,
  tandoorUrl: string,
  tandoorToken: string
) {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InstaRater/1.0)" },
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
  if (link.submittedById === session.user.id) return { error: "You cannot review your own submission" };

  await prisma.link.update({
    where: { id: linkId },
    data: {
      rating: rating as Rating,
      urgency: (parsed.data.urgency as Urgency) ?? null,
      reviewNote: parsed.data.reviewNote ?? null,
    },
  });

  revalidatePath("/");
  return { success: true };
}
