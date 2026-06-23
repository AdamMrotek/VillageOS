# Authentication

VillageOS uses Supabase Auth (email + password) with `@supabase/ssr` for cookie-based sessions in Next.js.

## Flows

- **Sign up** — `/sign-up` → Supabase sends confirmation email → user clicks link → signed in
- **Sign in** — `/sign-in` → on success redirects to `/events`
- **Forgot password** — `/forgot-password` → Supabase sends reset email → link goes to `/reset-password?token=<otp>&email=<addr>&type=recovery` → page calls `verifyOtp` (cross-device safe; no per-device PKCE verifier), scrubs the URL, shows new-password form → on success, full sign-out and redirect to `/sign-in`
- **Change password (logged-in)** — `/settings/password` → "Send verification code" calls `reauthenticate()` → Supabase emails a 6-digit nonce → user enters nonce + new password → `updateUser({ password, nonce })` → `signOut({ scope: "others" })` kicks all other devices; current session stays

## Required Supabase configuration

### 1. URL Configuration

**Dashboard → Authentication → URL Configuration**

| Field | Value |
| --- | --- |
| Site URL | `https://villageos.co.uk` |
| Redirect URLs | `https://villageos.co.uk/reset-password` |
| | `https://www.villageos.co.uk/reset-password` |
| | `http://localhost:3000/reset-password` |

Add Vercel preview wildcard if previews need to work:
```
https://village-os-web-*.vercel.app/reset-password
```
The `village-os-web.vercel.app` URL still resolves after the custom-domain
cutover, so keep its redirect entry too if you want the old host to work.

If the redirect URL isn't in the allow-list, Supabase silently falls back to the Site URL — emails will point to the wrong host (commonly `http://localhost:3000`).

### 2. Email templates

**Dashboard → Authentication → Email Templates → Reset Password**

The link embeds `{{ .Token }}` and `{{ .Email }}` as query params on a link to `/reset-password`. The client calls `verifyOtp({ email, token, type: 'recovery' })` to consume the token. This is JS-side, so headless email scanners (Outlook Safelinks, Mimecast, Barracuda) can't burn the link by pre-fetching it, and the same link works on any device — there's no per-device PKCE verifier.

```html
<h2>Reset your VillageOS password</h2>
<p>
  <a href="{{ .RedirectTo }}?token={{ .Token }}&type=recovery&email={{ .Email }}">
    Reset password
  </a>
</p>
<p>This link expires in 10 minutes. If you didn't request this, ignore.</p>
```

Use `{{ .RedirectTo }}` (the value `/forgot-password` passes per request — `http://localhost:3000/reset-password` in dev, the prod URL in prod), **not** `{{ .SiteURL }}`. `{{ .SiteURL }}` is a single static value set in the dashboard, so hardcoding it sends every email — including ones requested from `localhost` — to production. `{{ .RedirectTo }}` requires the value to be in **URL Configuration → Redirect URLs**, which is the same allow-list described above.

Other templates (**Confirm signup**, **Magic Link**, **Change Email**, **Invite user**) still use `{{ .ConfirmationURL }}` unless/until they're migrated to the same OTP pattern.

### 2a. Tighten OTP lifespan

**Authentication → Providers → Email → Email OTP Expiry** → `600` (10 minutes). Short window = lower exposure if the email is intercepted, screenshotted, or left in a shared inbox.

### 2b. Enable "Secure password change"

**Authentication → Sign In / Providers → Email → Secure password change** → **ON**.

With this off, any valid access token can call `PUT /auth/v1/user` with `{password}` directly — bypassing our UI entirely. With it on, `updateUser({ password })` is rejected unless the caller is in a recovery session (just completed `verifyOtp({ type: 'recovery' })`) or supplies a `nonce` from `reauthenticate()`. Net effect: a stolen bearer token alone can no longer change the password — the attacker also needs access to the user's email.

### Custom SMTP

> ✅ **Live.** VillageOS uses **Resend** as Supabase's custom SMTP; `villageos.co.uk`
> is verified and Auth emails send from `noreply@villageos.co.uk`. The steps below
> are the setup record. See [INTEGRATIONS.md](INTEGRATIONS.md#resend--transactional-email).

Configure your own SMTP provider in **Project Settings → Authentication → SMTP Settings**. This removes the rate limit and unlocks template editing.

**Recommended providers (transactional, free tiers):**

| Provider | Free tier | Notes |
| --- | --- | --- |
| Resend | 3,000/mo, 100/day | Cleanest DX, recommended |
| Brevo | 300/day, no card | Generous free tier |
| Postmark | 100/mo | Best deliverability |

**Resend setup:**
1. Sign up at resend.com, verify your sending domain (add SPF/DKIM DNS records)
2. Create an API key
3. In Supabase SMTP settings:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: *your Resend API key*
   - Sender email: `noreply@<your-domain>`
   - Sender name: `VillageOS`
4. Save — Supabase sends a test email
5. Template editor unlocks; rate limit lifts

## Google / OAuth sign-in

"Continue with Google" is offered on the landing sign-in form and the `/sign-up`
page via the shared `apps/web/src/components/google-sign-in-button.tsx`.

**Flow (PKCE):** the browser client calls `signInWithOAuth({ provider: "google" })`
with `redirectTo = ${origin}/auth/callback?next=/calendar`. Google sends the
user to Supabase, which redirects back to
`apps/web/src/app/auth/callback/route.ts`. That route handler calls
`exchangeCodeForSession(code)` (sets the session cookies server-side) and
redirects to `next` (default `/calendar`). On any failure it redirects to
`/?error=auth_callback_failed`.

**Consent (one-time gate).** Consent is *not* collected on the buttons — they're
a single click. After login the proxy checks `user.user_metadata.privacy_consent`
and redirects any logged-in, non-anonymous user without it to
`apps/web/src/app/consent/page.tsx`, which writes `privacy_consent` (version +
timestamp, reusing `PRIVACY_NOTICE_VERSION` / `PrivacyConsent` from
`apps/web/src/lib/privacy.ts`) and lets them through. This is the **single**
consent path for both email and Google sign-up; it shows once and never again.
Demo (anonymous, `is_anonymous=true`) sessions are exempt.

**Proxy.** `proxy.ts` (a) allowlists `/auth/*` for logged-out requests
(`isCallbackRoute`) so the callback's `code` isn't lost to the "logged-out → /"
redirect before the session cookie exists, and (b) enforces the consent gate via
`needsConsent` (allowing `/consent`, `/privacy`, and the callback through).

**Backend:** none. Google produces the same Supabase JWT the FastAPI backend
already verifies.

### Google Cloud + Supabase configuration (manual, one-time)

- **Google Cloud Console → APIs & Services**
  - OAuth consent screen: External; scopes `email`, `profile`, `openid`;
    Publish (basic scopes need no verification review).
  - Credentials → OAuth client ID → **Web application**. Authorized redirect
    URI (points at Supabase, exact):
    `https://hkablmuzbizmgmmlxegl.supabase.co/auth/v1/callback`. Authorized JS
    origins: app origins (prod, www, localhost) + the Supabase project URL.
- **Supabase → Authentication → Providers → Google** → enable, paste Client ID
  + Secret.
- **Supabase → Authentication → URL Configuration → Redirect URLs** → add the
  app callback URLs (point at *our app*, distinct from the Google redirect URI):
  `https://villageos.co.uk/auth/callback`,
  `https://www.villageos.co.uk/auth/callback`,
  `http://localhost:3000/auth/callback`, and the preview wildcard
  `https://village-os-web-*.vercel.app/auth/callback`.

## Security model

The reset and change-password flows are designed so that **possession of a session is not enough to change the password** — the user must also prove control of the email account on the *current page load*.

- **No session fallback on `/reset-password`** — the page only renders the password form after a successful `verifyOtp` *this load*. A logged-in attacker landing on the page without a fresh token sees the "invalid" state.
- **URL scrubbing on mount** — `window.history.replaceState` runs synchronously before any async work, so the token never leaks into referer headers, browser history, or screenshots taken after the page settles.
- **Single-use + short-lived tokens** — Supabase marks the OTP consumed on first `verifyOtp`; server-side expiry is 10 minutes.
- **Global sign-out after reset** — completing a reset triggers `signOut({ scope: "global" })`, killing the session everywhere (including any device where the email link may have leaked) and forcing fresh sign-in with the new password.
- **Secure password change enforced by Supabase** — with the setting enabled, Supabase's auth API rejects `updateUser({ password })` for ordinary sessions; only recovery sessions or `reauthenticate()` nonces are accepted. The check happens in GoTrue (Supabase's auth backend), not in our Next.js code — our app talks to it as a client. UI gates alone are not enough.
- **Email-in-URL tradeoff** — the reset link contains the user's email as a query param so the JS can call `verifyOtp({ email, token })`. It's only visible until the scrub runs (one synchronous tick) but is briefly observable to shoulder-surfers. If unacceptable, switch the template + client to the `token_hash` variant (`{{ .TokenHash }}` in the email, `verifyOtp({ token_hash, type: 'recovery' })` on the client) for the same cross-device behaviour without email exposure.

## Common issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| Reset link lands on `localhost:3000` from prod email | Redirect URL not in allow-list → fell back to Site URL | Add prod URL to **Redirect URLs** (above) |
| Reset link lands on **production** from a localhost request | Email template hardcodes `{{ .SiteURL }}` instead of `{{ .RedirectTo }}` | Update the Reset Password template to use `{{ .RedirectTo }}` as the link base (above) |
| `?error=auth_callback_failed#error=access_denied&error_code=otp_expired` | Token expired (>10 min) or already consumed by a previous click | Request a fresh link. Note: scanners no longer burn tokens with the OTP flow — they don't execute the JS that calls `verifyOtp`, so this is now rare |
| Reset link lands on app root, not `/reset-password` | Nested query string in `redirect_to` got mangled by Supabase | Use direct `redirectTo: ${origin}/reset-password` (no intermediate callback). See `apps/web/src/app/forgot-password/page.tsx` |
| "Email rate limit exceeded" after a few attempts | Hit the 2/hour cap | Configure custom SMTP (above) |
| Reset form shows "Link expired" immediately on landing | `/reset-password` was opened without `token`/`email`/`type=recovery` query params, or `verifyOtp` returned an error | Re-request from `/forgot-password` and click the email link directly. Do not bookmark or hand-edit the URL — the page only renders the password form after a successful OTP verification this load |

## Relevant files

- `apps/web/src/app/sign-in/page.tsx` — sign-in form, redirects to `/events`
- `apps/web/src/app/sign-up/page.tsx` — sign-up form
- `apps/web/src/app/forgot-password/page.tsx` — request reset email
- `apps/web/src/app/reset-password/page.tsx` — email-link landing; verifies OTP, sets new password, signs out globally
- `apps/web/src/app/(app)/settings/password/page.tsx` — logged-in password change via `reauthenticate()` + emailed nonce
- `apps/web/src/app/auth/callback/route.ts` — OAuth PKCE callback: exchanges the `code` for a session, then redirects (used by Google sign-in; not used in the reset path)
- `apps/web/src/app/consent/page.tsx` — one-time privacy-consent gate; proxy sends logged-in users here until `privacy_consent` is recorded
- `apps/web/src/components/google-sign-in-button.tsx` — shared "Continue with Google" button (landing form + `/sign-up`)
- `apps/web/src/proxy.ts` — middleware: route protection + session refresh
- `apps/web/src/lib/supabase/client.ts` — browser client
- `apps/web/src/lib/supabase/server.ts` — server client (RSC/route handlers)
