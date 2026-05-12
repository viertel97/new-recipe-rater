"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { submitLink } from "@/lib/actions";

export function SubmitLinkForm() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError("");
    setSuccess(false);
    setLoading(true);

    const result = await submitLink(formData);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      const form = document.getElementById("submit-link-form") as HTMLFormElement;
      form?.reset();
      setTimeout(() => setSuccess(false), 3000);
    }
    setLoading(false);
  }

  return (
    <form id="submit-link-form" action={handleSubmit} className="space-y-4">
      {error && (
        <div className="text-sm p-3 rounded-lg border border-destructive/20 bg-destructive/8 text-destructive animate-fade-in">
          {error}
        </div>
      )}
      {success && (
        <div
          className="text-sm p-3 rounded-lg border animate-fade-in"
          style={{
            borderColor: "oklch(0.55 0.15 145 / 20%)",
            background: "oklch(0.55 0.15 145 / 8%)",
            color: "oklch(0.70 0.15 145)",
          }}
        >
          Link submitted successfully
        </div>
      )}
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            id="url"
            name="url"
            type="url"
            placeholder="Paste a URL..."
            required
            className="bg-background/50 border-border/60 h-11"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rating-btn px-5 h-11 rounded-lg bg-coral text-coral-foreground text-sm font-semibold tracking-wide hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            "Submit"
          )}
        </button>
      </div>
    </form>
  );
}
