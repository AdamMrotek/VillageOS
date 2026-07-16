"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase";

/**
 * "Continue with Google" button.
 *
 * Consent isn't collected here — a first-time user is sent to the `/consent`
 * gate after login by the proxy (see proxy.ts / app/consent), so the button
 * stays a single click for everyone. Reusable on any page via the `next` prop.
 * The host app must serve the `/auth/callback` OAuth exchange route.
 */
export default function GoogleSignInButton({
  next = "/calendar",
}: {
  next?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      next,
    )}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // On success the browser is navigating to Google — no further state needed.
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex h-9 w-full items-center justify-center rounded-md border border-input bg-surface px-4 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {loading ? "Redirecting…" : "Continue with Google"}
      </button>
    </div>
  );
}
