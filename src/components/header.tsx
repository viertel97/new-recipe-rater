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
