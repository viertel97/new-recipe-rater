import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SwipeView } from "@/components/swipe-view";

export default async function SwipePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const links = await prisma.link.findMany({
    where: { rating: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { submittedBy: { select: { name: true, email: true } } },
  });

  return <SwipeView links={links} />;
}
