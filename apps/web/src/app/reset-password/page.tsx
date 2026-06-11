"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Status = "verifying" | "ready" | "invalid" | "success";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function verify() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      const email = params.get("email");
      const type = params.get("type");

      // Scrub the URL synchronously before any async work so the token
      // never leaks into referer headers, history entries, or screenshots.
      if (token || email) {
        window.history.replaceState({}, "", "/reset-password");
      }

      // Strict: must arrive with a valid recovery token. No session fallback —
      // a pre-existing session must not be enough to authorize a password change.
      if (!token || !email || type !== "recovery") {
        setStatus("invalid");
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "recovery",
      });

      setStatus(!error && data?.session ? "ready" : "invalid");
    }

    verify();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Recovery session was granted solely to change the password. Kill it
    // everywhere (including any device where the link may have leaked) and
    // make the user sign in fresh with the new password.
    await supabase.auth.signOut({ scope: "global" });
    setStatus("success");
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1500);
  }

  if (status === "verifying") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Verifying reset link…</p>
      </main>
    );
  }

  if (status === "success") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
          <p className="text-sm text-muted-foreground">
            Redirecting to sign in…
          </p>
        </div>
      </main>
    );
  }

  if (status === "invalid") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
          <p className="text-sm text-muted-foreground">
            This password reset link is invalid or has already been used.
          </p>
          <p className="text-sm text-muted-foreground">
            <Link href="/forgot-password" className="underline underline-offset-4">
              Request a new link
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            Enter a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">
              New password
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

          <div className="space-y-1">
            <label htmlFor="confirm" className="text-sm font-medium">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
