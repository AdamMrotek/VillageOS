import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback for the PKCE flow (Google "Continue with Google").
 *
 * The browser client redirects here with a `code` after Supabase hands the
 * user back from the provider. We exchange it for a session server-side so the
 * session cookies are set on the response, then bounce the user into the app.
 *
 * Privacy consent is *not* handled here — a first-time user lands on `/calendar`
 * but the proxy redirects them to the `/consent` gate until they've accepted
 * (see proxy.ts). This keeps consent collection in one place for both email and
 * Google sign-in.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/calendar";

  // Build redirects against the forwarded host so they resolve correctly
  // behind the Vercel proxy (prod, previews) as well as on localhost.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const origin =
    forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
