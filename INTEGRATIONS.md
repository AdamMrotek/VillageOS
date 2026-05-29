# Integrations

Third-party services VillageOS depends on, their current state, and exactly where
each one is configured. Use this as the checklist when rotating a key, changing a
domain, or onboarding a new environment.

> **Conventions**
> - **Secrets** never live in the repo. Local dev reads them from gitignored `.env`
>   files; production reads them from the **Vercel** dashboard (frontend) and
>   **GitHub repo secrets/variables** (backend deploy).
> - "Dashboard" steps happen in the provider's web console, not in code.

---

## At a glance

| Service | Role | State (2026-05-29) |
|---|---|---|
| **Supabase** | Auth (GoTrue) + Postgres + JWKS | ✅ Live — project `hkablmuzbizmgmmlxegl` |
| **AWS** (Lambda + API Gateway, SAM) | Backend host | ✅ Live — `eu-north-1`, stack `villageos-api` |
| **Vercel** | Frontend host | ✅ Live on `village-os-web.vercel.app`; `village.co.uk` ⏳ pending DNS |
| **GoDaddy** | Registrar + DNS for `village.co.uk` | ⏳ Domain bought today; records added, propagating |
| **Resend** | Transactional email (via Supabase SMTP) | ⏳ Sending domain `village.co.uk` pending DNS verification |
| **Groq** | LLM provider (**active**) | ✅ Live — `LLM_PROVIDER=groq` |
| **OpenAI** | LLM provider (standby) | 🟡 Configured but inactive |
| **GitHub Actions** | CI + deploy | ✅ Live — `ci.yml`, `deploy-api.yml` |

---

## Supabase — auth & database

**What it does.** Email/password auth (GoTrue) with `@supabase/ssr` cookie sessions,
Postgres with RLS, and JWKS public keys the API uses to verify JWTs asymmetrically
(no shared secret on the server). See [AUTH.md](AUTH.md) and [DATABASE.md](DATABASE.md).

**Where it's configured.**

| Location | Keys / settings |
|---|---|
| `apps/web/.env` (local) + **Vercel env** (prod) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `apps/api/.env` (local) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| **GitHub** secrets/vars (prod API) | `vars.SUPABASE_URL`, `secrets.SUPABASE_PUBLISHABLE_KEY`, `secrets.SUPABASE_SECRET_KEY` |
| `apps/api/template.yaml` | declares the params; values injected at deploy |
| **Supabase dashboard** | Auth → URL Configuration (Site URL / redirect URLs); SMTP settings (see Resend) |

**Code touchpoints.** `apps/web/src/lib/supabase/{server,client}.ts`,
`apps/web/src/proxy.ts`, `apps/api/app/core/auth.py`, `apps/api/app/core/db.py`.

**On domain change.** Update **Auth → URL Configuration** in the dashboard:
Site URL `https://village.co.uk`, add `https://village.co.uk/reset-password` to
redirect URLs (documented in [AUTH.md](AUTH.md#1-url-configuration)). Otherwise
sign-in and password-reset emails point at the wrong host.

---

## AWS — backend host (Lambda + API Gateway)

**What it does.** FastAPI runs on Lambda (Python 3.12, ARM64) behind an API Gateway
HTTP API, deployed as IaC via AWS SAM / CloudFormation. See [BACKEND.md](BACKEND.md).

- **Region:** `eu-north-1` (Stockholm) · **Stack:** `villageos-api`
- **Live URL:** `https://eep5cd3mp0.execute-api.eu-north-1.amazonaws.com`
- **Auth to deploy:** GitHub Actions assumes a scoped IAM role via OIDC —
  no long-lived AWS keys in the repo (`secrets.AWS_DEPLOY_ROLE_ARN`).

**Where it's configured.**

| Location | Purpose |
|---|---|
| `apps/api/template.yaml` | The whole stack (function, throttle, log group, params) |
| `apps/api/lambda_handler.py` | Mangum ASGI adapter entrypoint |
| `apps/api/samconfig.toml` | **Local** `sam deploy` params — **gitignored**, not used by CI |
| `.github/workflows/deploy-api.yml` | **Production** deploy; passes params from GitHub secrets/vars |

**On domain change.** The API stays on its `execute-api` URL for now (no custom
domain). The only domain-sensitive setting is CORS — see below.

---

## Vercel — frontend host

**What it does.** Hosts the Next.js app (`apps/web`). Auto-deploys from `main`;
preview deploys per PR.

- **Current URL:** `https://village-os-web.vercel.app`
- **Custom domain:** `village.co.uk` — added in the Vercel dashboard, **pending DNS**
  (apex `A → 216.198.79.1`; `www → cname.vercel-dns.com`).

**Where it's configured.**

| Location | Purpose |
|---|---|
| **Vercel dashboard → Settings → Environment Variables** | Prod values for all `NEXT_PUBLIC_*` + `RESEND_API_KEY` |
| **Vercel dashboard → Settings → Domains** | `village.co.uk` attachment + DNS instructions |
| `apps/web/next.config.ts` | Build config (no `vercel.json` in repo) |
| `apps/web/src/lib/api-fetch.ts` | Reads `NEXT_PUBLIC_API_URL` to call the backend |

**On domain change.** `NEXT_PUBLIC_API_URL` stays pointed at the `execute-api` URL —
**do not change it** when moving the frontend domain. After DNS verifies, redeploy
the frontend if the domain was attached after the last build.

---

## GoDaddy — registrar & DNS for `village.co.uk`

**What it does.** Domain registrar and authoritative DNS host. Bought 2026-05-29.

> The previous owner's nameservers (`phase8.net` / hosts.co.uk) may still appear in
> DNS lookups until GoDaddy's nameservers fully propagate. This is expected for a
> day-old domain and clears on its own.

**Records to maintain (all in the GoDaddy DNS panel):**

| Host | Type | Value | For |
|---|---|---|---|
| `@` | A | `216.198.79.1` | Vercel apex (copy exact value from Vercel) |
| `www` | CNAME | `cname.vercel-dns.com` | Vercel www |
| `_vercel` | TXT | *(token from Vercel)* | Vercel domain verification (if shown) |
| `send` | MX | `feedback-smtp.<region>.amazonses.com` (pri 10) | Resend |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | Resend SPF |
| `resend._domainkey` | TXT | `p=MIGf...` | Resend DKIM |
| `_dmarc` | TXT | *(optional DMARC policy)* | deliverability |

**Not referenced in any repo file** — managed entirely in the GoDaddy console.
Resend sends from the `send.` subdomain, so it does **not** conflict with any apex
MX/mail you keep.

---

## Resend — transactional email

**What it does.** SMTP provider for **Supabase Auth** emails (sign-up confirmation,
password reset, reauth nonce). It is **not** called from application code — it's
wired in as Supabase's custom SMTP server.

**Where it's configured.**

| Location | Purpose |
|---|---|
| **Resend dashboard → Domains** | Verify `village.co.uk` (SPF/DKIM/MX — see GoDaddy table) |
| **Supabase dashboard → Project Settings → Authentication → SMTP** | `smtp.resend.com:465`, user `resend`, password = Resend API key, sender `noreply@village.co.uk` |

**Current state.** Domain verification pending — Resend shows "Domain not found"
until the GoDaddy records propagate. Setup steps in [AUTH.md](AUTH.md#custom-smtp).

---

## Groq & OpenAI — LLM providers

**What they do.** Power event extraction in `apps/api/app/services/extraction.py`.
The provider is selected by `LLM_PROVIDER` (`groq` or `openai`).

- **Active:** Groq (`LLM_PROVIDER=groq`), model `groq/llama-4-scout-17b` per the
  eval matrix in [README.md](README.md). OpenAI is configured as a standby.

**Where it's configured.**

| Location | Keys |
|---|---|
| `apps/api/.env` (local) | `LLM_PROVIDER`, `GROQ_API_KEY`, `OPENAI_API_KEY` |
| **GitHub** secrets/vars (prod) | `vars.LLM_PROVIDER`, `secrets.GROQ_API_KEY`, `secrets.OPENAI_API_KEY` |
| `apps/api/template.yaml` | declares `LlmProvider`, `GroqApiKey`, `OpenAiApiKey` params |

**To switch provider in prod.** Set the `LLM_PROVIDER` GitHub **variable** and
redeploy the API. No code change required.

---

## GitHub Actions — CI/CD

**What it does.** `ci.yml` lints/tests/builds web + api on every push and PR.
`deploy-api.yml` builds and deploys the SAM stack on pushes to `main` that touch
`apps/api/**` (gated on ruff + pytest). See ADR-012 / ADR-013 in [ADL.md](ADL.md).

**Required repository secrets:** `AWS_DEPLOY_ROLE_ARN`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`.

**Required repository variables:** `SUPABASE_URL`, `LLM_PROVIDER`, `ALLOWED_ORIGINS`.

---

## CORS — the one setting coupling frontend ↔ backend

The browser calls the API directly from the frontend origin, so the API's allowed
origins **must include the frontend domain**. This is the setting most likely to
break when the frontend domain changes.

| Place | Value | Used by |
|---|---|---|
| **GitHub variable `ALLOWED_ORIGINS`** | `https://village.co.uk,https://www.village.co.uk,https://village-os-web.vercel.app` | **Production** (CI deploy) |
| `apps/api/samconfig.toml` | same list | **Local** `sam deploy` (gitignored) |
| `apps/api/.env` → `ALLOWED_ORIGINS` | `http://localhost:3000` | Local dev server |

Read at runtime in `apps/api/main.py` (`CORSMiddleware`). **After changing the
GitHub variable, redeploy the API** (`gh workflow run deploy-api.yml`) — the value is
baked in at deploy time.
