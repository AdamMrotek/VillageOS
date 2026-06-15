"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { seedDemo } from "@/lib/api-client";

export default function TryDemoButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    // Real auth.users row + JWT with is_anonymous=true. Sets the session
    // cookie via @supabase/ssr, so proxy sees the user on the next request.
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) {
      setError("Couldn't start the demo. Please try again.");
      setLoading(false);
      return;
    }

    try {
      await seedDemo(); // idempotent; no-op if already seeded
    } catch {
      // Seeding is best-effort — land them in the app even if it failed;
      // they'll just see an empty calendar they can populate themselves.
    }

    router.push("/calendar");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={startDemo}
        disabled={loading}
        className="inline-flex h-11 items-center justify-center rounded-sm bg-primary px-6 text-body text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
      >
        {loading ? "Setting up your demo…" : "Try the demo →"}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
