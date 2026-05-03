import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { categorizeLink } from "@/lib/categorize";

function validateToken(request: NextRequest): boolean {
  const secret = process.env.API_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  return auth.slice(7) === secret;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  if (!validateToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await prisma.link.findMany({
    where: { categoryStatus: "PENDING" },
    select: { id: true },
  });

  // Process sequentially with a 15s delay to avoid Groq TPM rate limits
  after(async () => {
    for (const link of pending) {
      await categorizeLink(link.id);
      await sleep(15_000);
    }
  });

  return NextResponse.json({ queued: pending.length });
}
