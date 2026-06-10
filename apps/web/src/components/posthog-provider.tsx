"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { createClient } from "@/lib/supabase/client";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// Default to EU to match our project region. Without this, posthog-js silently
// falls back to its US host and every request 404s against an EU-only project.
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/**
 * Client-side PostHog for the extraction experiment (move 1). Disabled-by-default:
 * with no NEXT_PUBLIC_POSTHOG_KEY the SDK never initialises and every `capture`
 * is an inert no-op, so local dev and previews stay silent.
 *
 * We `identify` with the Supabase user id so client funnel events
 * (extraction_shown / extraction_accepted) share a distinct_id with the server's
 * `extraction_assigned` (which keys on the JWT `sub` == the same id).
 */
export default function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!POSTHOG_KEY) return; // not configured in this environment → stay off

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // We only want the extraction funnel, not autocaptured pageviews/clicks.
      capture_pageview: false,
      autocapture: false,
      person_profiles: "identified_only",
    });

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) posthog.identify(user.id);
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        posthog.identify(session.user.id);
      } else if (event === "SIGNED_OUT") {
        posthog.reset();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
