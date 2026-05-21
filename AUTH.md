# Authentication

VillageOS uses Supabase Auth (email + password) with `@supabase/ssr` for cookie-based sessions in Next.js.

## Flows

- **Sign up** — `/sign-up` → Supabase sends confirmation email → user clicks link → signed in
- **Sign in** — `/sign-in` → on success redirects to `/events`
- **Forgot password** — `/forgot-password` → Supabase sends reset email → link goes to `/reset-password?code=...` → page exchanges code and shows new-password form → redirects to `/events`

## Required Supabase configuration

### 1. URL Configuration

**Dashboard → Authentication → URL Configuration**

| Field | Value |
| --- | --- |
| Site URL | `https://village-os-web.vercel.app` |
| Redirect URLs | `https://village-os-web.vercel.app/reset-password` |
| | `http://localhost:3000/reset-password` |

Add Vercel preview wildcard if previews need to work:
```
https://village-os-web-*.vercel.app/reset-password
```

If the redirect URL isn't in the allow-list, Supabase silently falls back to the Site URL — emails will point to the wrong host (commonly `http://localhost:3000`).

### 2. Email templates

**Dashboard → Authentication → Email Templates → Reset Password**

The link's `href` **must** use `{{ .ConfirmationURL }}`, not a hardcoded URL. That placeholder expands to the Supabase verify endpoint, which then bounces to `redirect_to` (our `/reset-password`).

Example body:
```html
<h2>Reset your VillageOS password</h2>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
<p>If you didn't request this, ignore this email.</p>
```

Same applies to **Confirm signup**, **Magic Link**, **Change Email**, and **Invite user** templates.

## Email rate limit (2/hour)

Supabase's built-in email service is hard-capped at **2 emails per hour per project** and the template configuration is locked. This blocks development and is unworkable in production.

### Fix: custom SMTP

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

## Common issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| Reset link lands on `localhost:3000` from prod email | Redirect URL not in allow-list → fell back to Site URL | Add prod URL to **Redirect URLs** (above) |
| `?error=auth_callback_failed#error=access_denied&error_code=otp_expired` | Email scanner/preview consumed the single-use token before the user clicked | Use a fresh link, click within a minute; try a different inbox if a scanner keeps burning links |
| Reset link lands on app root, not `/reset-password` | Nested query string in `redirect_to` got mangled by Supabase | Use direct `redirectTo: ${origin}/reset-password` (no intermediate callback). See `apps/web/src/app/forgot-password/page.tsx` |
| "Email rate limit exceeded" after a few attempts | Hit the 2/hour cap | Configure custom SMTP (above) |
| Reset form errors with "Auth session missing" | Recovery code wasn't exchanged | `/reset-password` exchanges `?code=` on mount; check browser console for errors |

## Relevant files

- `apps/web/src/app/sign-in/page.tsx` — sign-in form, redirects to `/events`
- `apps/web/src/app/sign-up/page.tsx` — sign-up form
- `apps/web/src/app/forgot-password/page.tsx` — request reset email
- `apps/web/src/app/reset-password/page.tsx` — exchanges recovery code, sets new password
- `apps/web/src/app/auth/callback/route.ts` — generic OAuth/code-exchange callback (kept for future OAuth flows; not used in the reset path)
- `apps/web/src/proxy.ts` — middleware: route protection + session refresh
- `apps/web/src/lib/supabase/client.ts` — browser client
- `apps/web/src/lib/supabase/server.ts` — server client (RSC/route handlers)
