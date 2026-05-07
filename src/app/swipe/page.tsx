import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SwipeView } from "@/components/swipe-view";
import { scheduleMediaResolution } from "@/lib/media-resolver";

export default async function SwipePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const links = await prisma.link.findMany({
    where: { rating: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      submittedBy: { select: { name: true, email: true } },
      mediaAsset: true,
    },
  });

  // Schedule background resolution for any unresolved pending links
  for (const link of links) {
    if (link.mediaStatus === "PENDING" || link.mediaStatus === "FAILED") {
      scheduleMediaResolution(link.id);
    }
  }

  return <SwipeView links={links} />;
}
