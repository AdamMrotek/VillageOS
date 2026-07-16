"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@repo/ui/lib/supabase";
import {
  PRIVACY_NOTICE_VERSION,
  type PrivacyConsent,
} from "@/lib/privacy";

/**
 * One-time consent gate. The proxy redirects any logged-in, non-anonymous user
 * without a `privacy_consent` record here (see proxy.ts), so it covers both
 * email and Google sign-up the first time — and is never shown again once
 * accepted. Demo (anonymous) sessions skip it entirely.
 */
export default function ConsentPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept() {
    setLoading(true);
    setError(null);

    // The version stamps the record so we can prove which notice this user
    // agreed to, and when. accepted_at is the client's clock — proportionate
    // for a small test.
    const privacy_consent: PrivacyConsent = {
      version: PRIVACY_NOTICE_VERSION,
      accepted_at: new Date().toISOString(),
    };

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: { privacy_consent },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // refresh() so the proxy re-reads the now-consented session and lets the
    // user through instead of bouncing them back here.
    router.push("/calendar");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            One more thing
          </h1>
          <p className="text-sm text-muted-foreground">
            Before you start, please confirm you&apos;re happy for us to handle
            your data.
          </p>
        </div>

        <p className="text-sm text-ink-soft">
          I agree to take part in this test and to VillageOS processing the data
          I enter — including any health or religious information my events may
          reveal about my family — as described in the{" "}
          <Link
            href="/privacy"
            target="_blank"
            className="text-ink underline underline-offset-4"
          >
            privacy notice
          </Link>
          .
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="button"
          onClick={accept}
          disabled={loading}
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Saving…" : "I agree — continue"}
        </button>
      </div>
    </main>
  );
}
