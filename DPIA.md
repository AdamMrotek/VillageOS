# Data Protection Impact Assessment — VillageOS

> Starter DPIA for VillageOS, following the **ICO's DPIA template structure**.
> Jurisdiction: **UK** (UK GDPR + Data Protection Act 2018, regulator = the
> **ICO**). Companion to `DATA_PROTECTION_CHECKLIST.md`.
>
> ⚠️ Not legal advice. A DPIA is a *living document* — complete it before real
> (non-fake) family data is entered, and revisit it whenever the processing
> materially changes. Confirm anything you'll file or sign on
> [ico.org.uk](https://ico.org.uk).

**Status:** Draft · started 2026-06-16 · _not yet signed off_
**Owner / controller:** Adam Mrotek (independent developer), contact
`privacy@villageos.co.uk`
**Trigger to finalise:** before the test flips from realistic-but-fake data to
real family data.

---

## 1. Do we need a DPIA? (Screening)

Yes — and it is **mandatory**, not discretionary. The processing trips several
ICO triggers simultaneously:

- **Special-category data** — family events predictably reveal **health**
  (vaccinations, GP/dental/optician/therapy appointments) and sometimes
  **religion** (religious celebrations).
- **Data about children** — children are vulnerable data subjects; a family OS
  processes data *about* them.
- **Automated processing / new technology** — pasted text and uploaded photos
  are processed by **LLMs** (Groq for text, OpenAI for images) to extract
  structured events.
- **Innovative use of technology combined with the above** is itself an ICO
  "likely high risk" indicator.

Any one of these can require a DPIA; together they make it clearly required.

## 2. Describe the processing

**Nature — what we do with the data.**
A user (a parent) pastes text or uploads a photo (e.g. a school newsletter, a
party invite, an appointment card). The content is sent to an LLM sub-processor
which returns **structured calendar events**. The original input is **not
persisted** — only the structured events are stored (raw input column dropped,
see ADR-018; images are inline-only with no S3 storage). Events are displayed
back to the user in their calendar. Access is isolated per user by **row-level
security** (ADR-010).

**Scope — what data, how much.**
- Account data: email, hashed password (Supabase auth).
- User-entered content: calendar events, messages, images — may contain
  children's names, schools, schedules.
- **Special-category data (incidental):** health and religious information
  contained *within* freeform event text. Not separately structured, categorised,
  or profiled.
- Provider users additionally store profile/cover images (AWS S3).
- Analytics: first-party product analytics stored in our own Supabase database
  (no third-party analytics processor, ADR-023), keyed to the stable Supabase
  user id — no device cookie/localStorage.

**Context.**
- ~10 friendly testers at the current stage, instructed to use
  realistic-but-fake details. This DPIA governs the move to **real** family data.
- Users are adults (account holders); the data subjects include their children.
- Cross-border transfer: text → **Groq (US)**, images → **OpenAI (US)**, both
  under DPAs with SCCs/UK Addendum.

**Purposes.**
Solely to run the product: convert submitted content into calendar events and
display the user's calendar. No advertising, no profiling, no secondary use.

## 3. Consultation

- **Data subjects:** the one-screen privacy notice (`/privacy`) sets
  expectations; the small test cohort can give direct feedback. Formal
  consultation is proportionate to defer until launch scale.
- **Processors:** OpenAI, Groq, Supabase, AWS — reviewed via their published
  DPAs/sub-processor terms. (Analytics is first-party in Supabase, ADR-023 — no
  separate analytics processor.)
- **DPO:** none appointed (not required at this scale); owner acts as contact.

## 4. Necessity and proportionality

- **Lawful basis:** consent (Art 6(1)(a)), captured and version-stamped at
  sign-up; withdrawable by account deletion.
- **Article 9 condition** for special-category data: **explicit consent**
  (Art 9(2)(a)) — the privacy notice names health/religious data in a dedicated
  section and the sign-up checkbox explicitly consents to it.
- **Data minimisation:** raw inputs are never stored — only structured events;
  testers asked to use fake details until this DPIA is finalised. Special-category
  data is kept *incidental* (freeform text), never structured or profiled.
- **Retention:** data lives while the account exists; deleted on request via
  self-serve **Settings → Delete account**, and test data may be purged when the
  test concludes. _(Define a concrete maximum retention period before real data —
  open Tier 1 item.)_
- **Rights:** access, rectification, erasure — self-serve deletion plus the
  privacy contact email; ICO complaint route stated.

## 5. Identify and assess risks

| # | Risk to individuals | Likelihood | Severity | Overall |
|---|---|---|---|---|
| R1 | Unauthorised access to another user's family/health data | Low | High | Medium |
| R2 | Special-category data exposed via LLM sub-processor (transfer/retention) | Low | High | Medium |
| R3 | Scope creep builds a structured health dataset/profile of children | Medium | High | High (if unmanaged) |
| R4 | Excessive/real data collected during the test phase | Medium | Medium | Medium |
| R5 | Account takeover of an admin/owner account exposes all data | Low | High | Medium |
| R6 | Data retained longer than needed | Medium | Low | Low |

## 6. Measures to reduce risk

| # | Measure | Status |
|---|---|---|
| R1 | Row-level security so a query can't reach another user's rows (ADR-010); Supabase auth; secrets in env/Lambda, not the repo | ✅ in place |
| R2 | No raw-input persistence (ADR-018); Groq Zero Data Retention on; OpenAI training disabled (~30-day abuse retention only); both under DPAs w/ SCCs + UK Addendum; both disclosed in notice | ✅ in place |
| R3 | Design rule: keep health/religion **incidental** — no `category: medical` field, no health-filtered view, no profiling; any such feature must revisit this DPIA first. Stated as a user-facing promise in the notice | ✅ rule set |
| R4 | Testers instructed to use realistic-but-fake data until this DPIA is finalised; minimise stored fields | ✅ / 🔄 ongoing |
| R5 | Enable 2FA on owner's Supabase / OpenAI / Groq / email accounts (protects the keys to everything) | ⬜ to do |
| R6 | Define and apply a concrete maximum retention period before real data; encryption at rest is provided by Supabase by default | ⬜ to do |

## 7. Sign-off and outcome

| Item | Detail |
|---|---|
| Residual risk | **Low–Medium**, acceptable for the scoped test once R5/R6 are closed |
| Measures approved by | _Owner — pending finalisation_ |
| DPO advice | n/a (no DPO) |
| Consultation with ICO needed? | No — residual risk is not "high" after mitigations |
| Review date | On any material change to processing (new feature touching health/religion, new sub-processor, move to scale), or annually |

---

### Open items before real (non-fake) family data
1. Define a concrete maximum **retention period** and apply it.
2. Enable **2FA** on the owner's admin/provider accounts.
3. **Sign off** section 7 (owner).
4. Pay the **ICO data protection fee** (~£40/yr) — see checklist Tier 1.
