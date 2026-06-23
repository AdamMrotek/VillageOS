import type { User } from "@supabase/supabase-js";

import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy";

/**
 * Test factory for the Supabase `User`. Returns a fully-typed `User` (exactly
 * the shape `getUser()` resolves to) with sensible defaults, so tests construct
 * only the fields they care about via `overrides`.
 *
 * Defaults model a plain, authenticated, **non-consented** email user — the
 * most common starting point. Use the helpers below for the other states.
 *
 *   makeUser()                         // logged-in, no consent yet
 *   makeUser({ is_anonymous: true })   // demo session
 *   consentedUser()                    // has a privacy_consent record
 *   demoUser()                         // anonymous demo session
 */
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    email: "parent@example.com",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** An authenticated user who has recorded privacy consent. */
export function consentedUser(overrides: Partial<User> = {}): User {
  return makeUser({
    user_metadata: {
      privacy_consent: {
        version: PRIVACY_NOTICE_VERSION,
        accepted_at: "2026-01-01T00:00:00.000Z",
      },
    },
    ...overrides,
  });
}

/** An anonymous demo session ("Try the demo"). */
export function demoUser(overrides: Partial<User> = {}): User {
  return makeUser({ is_anonymous: true, ...overrides });
}
