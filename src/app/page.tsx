import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Header } from "@/components/header";
import { Dashboard } from "@/components/dashboard";
import { SubmitLinkForm } from "@/components/submit-link-form";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const links = await prisma.link.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      submittedBy: { select: { name: true, email: true } },
      mediaAsset: true,
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        <div className="animate-slide-up">
          <div className="glass-card rounded-xl p-6">
            <h2 className="font-heading text-xl italic text-foreground mb-4">
              Share a link
            </h2>
            <SubmitLinkForm />
          </div>
        </div>
        <div className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <Dashboard links={links} currentUserId={session.user.id} tandoorUrl={process.env.TANDOOR_URL} />
        </div>
      </main>
    </div>
  );
}
