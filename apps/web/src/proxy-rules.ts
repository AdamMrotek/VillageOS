/**
 * Pure routing policy for the proxy (middleware). Separated from the Supabase /
 * Next plumbing in proxy.ts so the access rules can be unit-tested in isolation
 * (see proxy-rules.test.ts) — no request objects or network mocks needed.
 *
 * Access matrix — what each route does per user state:
 *
 *   Route                                 | logged-out | needs consent | consented / demo
 *   --------------------------------------|------------|---------------|------------------
 *   /auth/*, /privacy, /reset-password    | pass       | pass          | pass
 *   /, /sign-up, /forgot-password (guest) | pass       | → /consent    | → /calendar
 *   /consent                              | → /        | pass          | → /calendar
 *   everything else (app)                 | → /        | → /consent    | pass
 *
 * - /auth/*: the OAuth return arrives still logged-out (session cookies are set
 *   only once the callback exchanges the code) — must always pass.
 * - /privacy: the notice is linked from the consent gate, so it must be
 *   reachable before consent is given.
 * - /reset-password: a recovery session is "logged in", so this must bypass
 *   both the guest-redirect and the consent gate or the reset flow breaks.
 * - guest routes are the logged-out home (landing hosts the sign-in form +
 *   "Try the demo", which creates an anonymous session).
 */

import type { User } from "@supabase/supabase-js";

/**
 * The slice of the Supabase `User` the routing policy actually reads. Derived
 * from the real type with `Pick`, so it stays in sync if Supabase renames a
 * field, while documenting that the policy depends only on these two. A full
 * `User` (e.g. from `getUser()` or the test factory) is assignable to it.
 */
export type ProxyUser = Pick<User, "is_anonymous" | "user_metadata"> | null;

/**
 * Given the request path and the current user, return the pathname to redirect
 * to, or `null` to let the request through. The caller is responsible for the
 * redirect-loop guard (skip redirecting to the current path).
 */
export function resolveRedirect(
  pathname: string,
  user: ProxyUser,
): string | null {
  const alwaysAllowed =
    pathname.startsWith("/auth") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/reset-password");

  const isGuestRoute =
    pathname === "/" ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/forgot-password");

  const isConsentRoute = pathname === "/consent";

  // Real (non-anonymous) accounts must record privacy consent once before they
  // can use the app. Demo (anonymous) sessions are exempt: throwaway sample data.
  const needsConsent =
    !!user && !user.is_anonymous && !user.user_metadata?.privacy_consent;

  if (alwaysAllowed) {
    return null;
  }
  if (!user) {
    // Logged-out: only the guest routes are reachable; everything else → home.
    return isGuestRoute ? null : "/";
  }
  if (needsConsent) {
    // Logged-in without consent: nothing but the gate.
    return isConsentRoute ? null : "/consent";
  }
  // Logged-in + consented (or demo): app is open; keep them off the logged-out
  // home and the now-pointless gate.
  return isGuestRoute || isConsentRoute ? "/calendar" : null;
}
