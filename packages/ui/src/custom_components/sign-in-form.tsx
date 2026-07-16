"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "../lib/supabase";
import GoogleSignInButton from "./google-sign-in-button";

/** Email + password sign-in, shared by web and admin. Routes are injected by
 *  the host app: web passes its sign-up / forgot-password pages and enables
 *  Google; admin renders the bare form with none of them. */
export default function SignInForm({
  redirectTo,
  signUpHref,
  forgotPasswordHref,
  showGoogle = false,
  showHeading = true,
}: {
  /** Where to navigate after a successful sign-in. */
  redirectTo: string;
  /** Sign-up page; omit to hide the "Don't have an account?" line. */
  signUpHref?: string;
  /** Forgot-password page; omit to hide the link. */
  forgotPasswordHref?: string;
  /** Show "Continue with Google" — the host app must serve /auth/callback. */
  showGoogle?: boolean;
  /** Hide the built-in "Sign in" heading when the host provides its own. */
  showHeading?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase returns a deliberately vague "Invalid login credentials" for
      // both wrong password and unknown email (no account enumeration). Keep
      // that property but make the copy friendlier and point to sign-up.
      setError(
        error.message === "Invalid login credentials"
          ? signUpHref
            ? "Wrong email or password. No account yet? Sign up below."
            : "Wrong email or password."
          : error.message,
      );
      setLoading(false);
    } else {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      {(showHeading || signUpHref) && (
        <div className="space-y-1">
          {showHeading && (
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          )}
          {signUpHref && (
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href={signUpHref} className="underline underline-offset-4">
                Sign up
              </Link>
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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
            autoComplete="current-password"
            className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {forgotPasswordHref && (
          <p className="text-sm text-muted-foreground text-center">
            <Link
              href={forgotPasswordHref}
              className="underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </p>
        )}
      </form>

      {showGoogle && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <GoogleSignInButton next={redirectTo} />
        </>
      )}
    </div>
  );
}
