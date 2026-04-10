import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { submitLinkSchema } from "@/lib/validations";

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

  const body = await request.json();
  const parsed = submitLinkSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const existing = await prisma.link.findFirst({
    where: { url: parsed.data.url },
  });
  if (existing) {
    return NextResponse.json(
      { error: "This link has already been submitted" },
      { status: 409 }
    );
  }

  const submitter = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!submitter) {
    return NextResponse.json(
      { error: "No user found" },
      { status: 500 }
    );
  }

  const link = await prisma.link.create({
    data: {
      url: parsed.data.url,
      notes: parsed.data.notes,
      submittedById: submitter.id,
    },
  });

  return NextResponse.json({ success: true, id: link.id }, { status: 201 });
}
