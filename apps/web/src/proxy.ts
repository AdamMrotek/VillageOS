import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Access matrix — what each route does per user state. The single source of
  // truth for routing; the logic below is a direct transcription of it.
  //
  //   Route                                 | logged-out | needs consent | consented / demo
  //   --------------------------------------|------------|---------------|------------------
  //   /auth/*, /privacy, /reset-password    | pass       | pass          | pass
  //   /, /sign-up, /forgot-password (guest) | pass       | → /consent    | → /calendar
  //   /consent                              | → /        | pass          | → /calendar
  //   everything else (app)                 | → /        | → /consent    | pass
  //
  // - /auth/*: the OAuth return arrives still logged-out (session cookies are
  //   set only once the callback exchanges the code) — must always pass.
  // - /privacy: the notice is linked from the consent gate, so it must be
  //   reachable before consent is given.
  // - /reset-password: a recovery session is "logged in", so this must bypass
  //   both the guest-redirect and the consent gate or the reset flow breaks.
  // - guest routes are the logged-out home (landing hosts the sign-in form +
  //   "Try the demo", which creates an anonymous session).
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
  // can use the app — captured at the /consent gate, written to user metadata.
  // Demo (anonymous) sessions are exempt: the demo is throwaway sample data.
  const needsConsent =
    !!user && !user.is_anonymous && !user.user_metadata?.privacy_consent;

  let redirectTo: string | null = null;
  if (alwaysAllowed) {
    redirectTo = null;
  } else if (!user) {
    // Logged-out: only the guest routes are reachable; everything else → home.
    redirectTo = isGuestRoute ? null : "/";
  } else if (needsConsent) {
    // Logged-in without consent: nothing but the gate.
    redirectTo = isConsentRoute ? null : "/consent";
  } else {
    // Logged-in + consented (or demo): app is open; keep them off the
    // logged-out home and the now-pointless gate.
    redirectTo = isGuestRoute || isConsentRoute ? "/calendar" : null;
  }

  if (redirectTo && redirectTo !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
