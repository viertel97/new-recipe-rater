"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { submitLinkSchema, rateLinkSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { Rating, Urgency } from "@/generated/prisma/client";

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

export async function importToTandoor(linkId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated" };

  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return { error: "Link not found" };
  if (link.rating !== "GOOD") return { error: "Only GOOD-rated links can be imported" };

  const tandoorUrl = process.env.TANDOOR_URL;
  const tandoorToken = process.env.TANDOOR_TOKEN;
  if (!tandoorUrl || !tandoorToken) return { error: "Tandoor is not configured" };

  // Fetch the recipe page HTML
  let html: string;
  try {
    const res = await fetch(link.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InstaRater/1.0)" },
    });
    html = await res.text();
  } catch {
    return { error: "Failed to fetch recipe page" };
  }

  // Send to Tandoor bookmarklet-import API
  try {
    const res = await fetch(`${tandoorUrl}/api/bookmarklet-import/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tandoorToken}`,
      },
      body: JSON.stringify({ url: link.url, html }),
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
