import { describe, expect, it } from "vitest";
import { resolveRedirect, type ProxyUser } from "./proxy-rules";
import { consentedUser, demoUser, makeUser } from "@/test/user-factory";

// User-state fixtures, built from the real Supabase `User` shape.
const loggedOut: ProxyUser = null;
const needsConsent: ProxyUser = makeUser(); // authenticated, no consent yet
const consented: ProxyUser = consentedUser();
const demo: ProxyUser = demoUser();

describe("resolveRedirect", () => {
  // [pathname, user, expected redirect | null]. Mirrors the access matrix in
  // proxy-rules.ts.
  const cases: Array<[string, ProxyUser, string | null]> = [
    // Always-allowed routes pass in every state.
    ["/privacy", loggedOut, null],
    ["/privacy", needsConsent, null],
    ["/privacy", consented, null],
    ["/auth/callback", loggedOut, null],
    ["/auth/callback", needsConsent, null],
    ["/reset-password", needsConsent, null], // recovery session bypasses gate
    ["/reset-password", consented, null],

    // Logged-out: only guest routes; everything else → home.
    ["/", loggedOut, null],
    ["/sign-up", loggedOut, null],
    ["/forgot-password", loggedOut, null],
    ["/calendar", loggedOut, "/"],
    ["/consent", loggedOut, "/"],

    // Logged-in, no consent: nothing but the gate.
    ["/calendar", needsConsent, "/consent"],
    ["/", needsConsent, "/consent"],
    ["/sign-up", needsConsent, "/consent"],
    ["/consent", needsConsent, null],

    // Logged-in + consented: app open; off the guest routes and the gate.
    ["/calendar", consented, null],
    ["/settings", consented, null],
    ["/", consented, "/calendar"],
    ["/sign-up", consented, "/calendar"],
    ["/consent", consented, "/calendar"],

    // Demo (anonymous) sessions skip the consent gate entirely.
    ["/calendar", demo, null],
    ["/consent", demo, "/calendar"],
    ["/", demo, "/calendar"],
  ];

  it.each(cases)("%s for %o → %s", (pathname, user, expected) => {
    expect(resolveRedirect(pathname, user)).toBe(expected);
  });
});
