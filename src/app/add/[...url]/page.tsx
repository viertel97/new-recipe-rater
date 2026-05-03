import { prisma } from "@/lib/db";
import { submitLinkSchema } from "@/lib/validations";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { categorizeLink } from "@/lib/categorize";

export default async function AddLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ url: string[] }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const { url: urlSegments } = await params;

  const secret = process.env.API_SECRET;
  if (!secret || token !== secret) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#ef4444" }}>Unauthorized</h1>
        <p>Invalid or missing token.</p>
      </div>
    );
  }

  // Reconstruct URL from path segments: ["https:", "", "www.instagram.com", "p", "abc"]
  // becomes "https://www.instagram.com/p/abc"
  const reconstructed = urlSegments.join("/").replace(/^(https?):\/(?!\/)/, "$1://");

  const parsed = submitLinkSchema.safeParse({ url: reconstructed });
  if (!parsed.success) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#ef4444" }}>Invalid URL</h1>
        <p>{parsed.error.issues[0].message}</p>
        <p style={{ color: "#666" }}>Received: {reconstructed}</p>
      </div>
    );
  }

  const existing = await prisma.link.findFirst({
    where: { url: parsed.data.url },
  });
  if (existing) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#f59e0b" }}>Already exists</h1>
        <p>This link has already been submitted.</p>
      </div>
    );
  }

  const submitter = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!submitter) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#ef4444" }}>Error</h1>
        <p>No user configured.</p>
      </div>
    );
  }

  const link = await prisma.link.create({
    data: {
      url: parsed.data.url,
      submittedById: submitter.id,
    },
  });

  after(() => categorizeLink(link.id));

  redirect("/");
}
