"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  PRIVACY_NOTICE_VERSION,
  type PrivacyConsent,
} from "@/lib/privacy";

type Role = "parent" | "provider";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("parent");
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consented) {
      setError("Please agree to the privacy notice to continue.");
      return;
    }
    setLoading(true);
    setError(null);

    // Stored in auth metadata so we can prove which notice version this user
    // agreed to, and when. The timestamp is the client's clock — proportionate
    // for a small test; auth.users.created_at is the server-authoritative
    // backstop since consent is required to sign up.
    const privacy_consent: PrivacyConsent = {
      version: PRIVACY_NOTICE_VERSION,
      accepted_at: new Date().toISOString(),
    };

    const supabase = createClient();
    // The role lands in user_metadata; the handle_new_user trigger copies it
    // into profiles.role on confirmation.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role, privacy_consent } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
            account, then{" "}
            <Link href="/" className="underline underline-offset-4">
              sign in
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
          <p className="text-sm text-muted-foreground">
            Already have one?{" "}
            <Link href="/" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <span className="text-sm font-medium">I&apos;m signing up as a</span>
            <div className="grid grid-cols-2 gap-2">
              {(["parent", "provider"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  aria-pressed={role === option}
                  className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium capitalize transition-colors ${
                    role === option
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-surface text-ink-soft hover:text-ink"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <label
            htmlFor="consent"
            className="flex items-start gap-2.5 text-sm text-ink-soft"
          >
            <input
              id="consent"
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <span>
              I agree to take part in this test and to VillageOS processing the
              data I enter — including any health or religious information my
              events may reveal about my family — as described in the{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="text-ink underline underline-offset-4"
              >
                privacy notice
              </Link>
              .
            </span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading || !consented}
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>
    </main>
  );
}
