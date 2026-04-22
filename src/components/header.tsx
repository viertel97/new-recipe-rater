import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export async function Header() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl italic tracking-tight text-foreground">
          Recipe Rater
        </h1>
        <div className="flex items-center gap-4">
          <a
            href="/swipe"
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            title="Swipe mode"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <rect x="2" y="2" width="20" height="20" rx="3" />
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>
          <span className="text-xs text-muted-foreground hidden sm:inline tracking-wide">
            {session.user.name || session.user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign Out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
