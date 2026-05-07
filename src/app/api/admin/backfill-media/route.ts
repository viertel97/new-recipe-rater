import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { resolveMediaForLink } from "@/lib/media-store";

function validateToken(request: NextRequest): boolean {
  const secret = process.env.API_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  return auth.slice(7) === secret;
}

export async function POST(request: NextRequest) {
  if (!validateToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await prisma.link.findMany({
    where: { mediaStatus: { in: ["PENDING", "FAILED"] } },
    select: { id: true },
  });

  after(async () => {
    for (const link of pending) {
      await resolveMediaForLink(link.id, { force: true });
    }
  });

  return NextResponse.json({ queued: pending.length });
}
