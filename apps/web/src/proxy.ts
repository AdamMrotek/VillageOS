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

  const isAuthRoute =
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/forgot-password");
  const isRecoveryRoute = pathname.startsWith("/reset-password");
  // The landing page ("/") hosts the sign-in form and "Try the demo" pitch;
  // it's reachable logged-out. "Try the demo" creates an anonymous session
  // client-side, after which proxy sees the user. The privacy notice must also
  // be readable before sign-up — it's linked from the landing page and the
  // consent checkbox, so a logged-out visitor has to reach it.
  const isLandingRoute = pathname === "/";
  const isPublicRoute = isLandingRoute || pathname.startsWith("/privacy");

  if (!user && !isAuthRoute && !isRecoveryRoute && !isPublicRoute) {
    const url = request.nextUrl.clone();
    // The landing page ("/") hosts the sign-in form, so logged-out users
    // bounced off a protected route land there rather than a dedicated page.
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // A logged-in user (including anonymous demo sessions) has no use for the
  // landing page or the auth forms — send them straight to the app.
  if (user && (isAuthRoute || isLandingRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/calendar";
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
