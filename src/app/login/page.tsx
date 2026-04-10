"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid username or password");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient gradient orbs */}
      <div
        className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-[0.07]"
        style={{ background: "radial-gradient(circle, oklch(0.75 0.12 25), transparent 70%)" }}
      />
      <div
        className="absolute bottom-[-15%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-[0.05]"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.14 65), transparent 70%)" }}
      />

      <div className="w-full max-w-sm animate-slide-up relative z-10">
        {/* Branding */}
        <div className="text-center mb-10">
          <h1 className="font-heading text-5xl italic tracking-tight text-foreground">
            Insta Rater
          </h1>
          <p className="text-muted-foreground text-sm mt-3 tracking-wide uppercase">
            Curate together
          </p>
        </div>

        {/* Login form */}
        <div className="glass-card rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg border border-destructive/20">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs uppercase tracking-wider text-muted-foreground">
                Username
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                required
                autoCapitalize="none"
                autoCorrect="off"
                className="bg-background/50 border-border/60 h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
                className="bg-background/50 border-border/60 h-11"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-11 bg-coral text-coral-foreground hover:opacity-90 transition-opacity font-semibold tracking-wide"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </div>

        {/* Subtle footer */}
        <p className="text-center text-xs text-muted-foreground/50 mt-8">
          A private space for curation
        </p>
      </div>
    </div>
  );
}
