import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Header } from "@/components/header";
import { Dashboard } from "@/components/dashboard";
import { SubmitLinkForm } from "@/components/submit-link-form";
import { getSharedCollection } from "@/lib/actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { c: token } = await searchParams;
  const collection = token ? await getSharedCollection(token) : null;
  const expiredToken = Boolean(token) && collection === null;

  const links = await prisma.link.findMany({
    where: collection ? { id: { in: collection.linkIds } } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      rating: true,
      urgency: true,
      notes: true,
      reviewNote: true,
      tandoorRecipeId: true,
      category: true,
      categoryStatus: true,
      createdAt: true,
      submittedById: true,
      mediaStatus: true,
      submittedBy: { select: { name: true, email: true } },
      mediaAsset: true,
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        {!collection && (
          <div className="animate-slide-up">
            <div className="glass-card rounded-xl p-6">
              <h2 className="font-heading text-xl italic text-foreground mb-4">
                Share a link
              </h2>
              <SubmitLinkForm />
            </div>
          </div>
        )}
        <div className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <Dashboard
            links={links}
            currentUserId={session.user.id}
            tandoorUrl={process.env.TANDOOR_URL}
            collection={collection}
            expiredToken={expiredToken}
          />
        </div>
      </main>
    </div>
  );
}
