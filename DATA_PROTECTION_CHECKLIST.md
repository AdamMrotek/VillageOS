# Data Protection — Pre-Launch Checklist

> Practical UK GDPR / ICO checklist for VillageOS, scoped to a **small private
> test with real parents** through to a public launch. Jurisdiction assumed: **UK**
> (UK GDPR + Data Protection Act 2018, regulator = the **ICO**).
>
> ⚠️ Not legal advice. This is a working checklist to stay proportionate and
> honest — confirm anything you'll file or sign on [gov.uk](https://www.gov.uk)
> / [ico.org.uk](https://ico.org.uk) or with an accountant/solicitor.

---

## Tier 0 — Before you let *any* real parent test the app

The minimum to test with ~10 friendly parents without taking on real risk.

- [x] **Minimise real personal data.** ✅ The privacy notice asks testers to use
      *realistic-but-fake* details, and the raw inputs are never persisted: pasted
      text + uploaded photos go to the extractor and only the structured events
      come back (`raw_text` column dropped; images inline-only, no S3 — see
      ADR-018). Provider profile/cover images are the only user uploads stored.
- [x] **Consent before they start.** ✅ Lawful basis is *consent*, captured at
      sign-up as a version-stamped record (`PRIVACY_NOTICE_VERSION` in
      `apps/web/src/lib/privacy.ts`); withdrawable by deleting the account.
- [x] **One-screen privacy notice.** ✅ Live at `/privacy`
      (`apps/web/src/app/privacy/page.tsx`): who we are, what we collect, why,
      retention, deletion route, contact email — version-stamped.
- [x] **Deletion on request.** ✅ Self-serve **Settings → Delete account**
      (`apps/api/app/routers/account.py`) permanently erases the account + data,
      incl. provider image objects in S3; deletion path also stated in the notice.
- [x] **Disclose the LLM sub-processors.** ✅ Both **OpenAI** (photos) and **Groq**
      (text) named in the privacy notice, with US transfer + retention stance.
- [x] **Turn off training on your data.** ✅ Confirmed 2026-06: all three OpenAI
      org data-sharing controls (model feedback, eval/fine-tuning data, inputs &
      outputs) set to **Disabled** → API data is not used to train OpenAI's models.
      *Note: training ≠ retention — OpenAI still retains API data ~30 days for
      abuse monitoring, then deletes (separate from training; Zero Data Retention
      is a separate opt-in if ever needed).*
- [x] **Accept the LLM DPAs.** ✅ Confirmed 2026-06-16. The training toggle is a
      setting, not a contract — the DPA is what makes the controller→processor
      relationship legally sound under UK GDPR.
      - **OpenAI:** executed online (org settings). Counterparty is **OpenAI
        OpCo, LLC (US)** — UK is outside the EEA, so the transfer is UK→US,
        covered by the DPA's SCCs/UK Addendum. Countersigned PDF saved.
      - **Groq:** no separate signing — Groq's DPA is auto-incorporated into the
        Services Agreement (accepted at account creation). Current version saved
        for records.
- [x] **Basic security hygiene.** ✅ Supabase auth on; **RLS load-bearing** so a
      query can't reach another user's rows (ADR-010); secrets in env / Lambda
      vars, not the repo.
- [x] **Settle analytics & cookies (PECR).** ✅ Confirmed 2026-06-16; updated
      2026-07-20. Product analytics have been **removed** — the first-party
      `analytics_events` table and its funnel were dropped along with the
      extraction A/B experiment. There is now **no analytics collection at all**,
      no third-party analytics service, and nothing stored on the device (no
      cookie, no localStorage), so no PECR consent banner is required.

## Tier 1 — When real (not fake) personal data is involved

If/when testers enter genuine family data, add:

- [ ] **Pay the ICO data protection fee** (~£40/yr, tier 1 small org). Required
      once you process personal data for the product (not "personal/household").
      ~10-min online form at ico.org.uk.
- [ ] **Treat children's data as sensitive.** A family OS processes data *about*
      children — children are *vulnerable data subjects*, so UK GDPR raises the
      bar across the board (it does **not** make their data automatically
      "special category" — that's the next bullet, and the two stack). Keep
      minimising; don't collect more than the feature needs.
- [x] **You *are* processing special-category data — plan for it, not "watch"
      for it.** ✅ Acknowledged 2026-06-16. A family calendar predictably contains
      **health** (vaccinations, GP/dental/optician/therapy appointments) and
      sometimes **religion** (religious celebrations). This is *expected*, not
      hypothetical, so it carries the Article 9 higher bar. Two things follow,
      both now handled at the *test* level:
      - **Explicit consent (the Article 9 condition).** ✅ The privacy notice now
        names health/religious data in a dedicated "Sensitive (special category)
        information" section, and the sign-up checkbox explicitly consents to it
        (`PRIVACY_NOTICE_VERSION` bumped to `2026-06-16.2`). Explicit consent is
        the Art 9(2)(a) condition that sits *on top of* the ordinary consent
        basis. Withdrawable by deleting the account.
      - **Don't build a structured health dataset.** ✅ Design rule: keep medical
        details *incidental* (freeform event title), never a `category: medical`
        field, health-filtered view, or any feature that singles out / profiles
        health or religion — doing so turns incidental Art 9 data into
        *intentional* Art 9 processing (a higher bar again) and **must** trigger
        a DPIA revisit first. Stated in the notice as a promise to the user.
- [ ] **Write the DPIA before real families enter data.** Special-category data
      **about children**, processed via **automated LLM extraction** — this hits
      several ICO mandatory-DPIA triggers at once, so it is *required*, not
      "likely" (see Tier 2). It's a ~2–3 page document, not a project; a starter
      lives at `DPIA.md`. Do it once before the fake-data test flips to real
      family data; revisit only when processing materially changes.
- [ ] **Record your processors.** You = controller; Supabase, OpenAI, Groq,
      hosting = processors. Keep a short list of who touches the data and where
      (incl. cross-border transfers to the LLMs — OpenAI/Groq are US-based).
- [ ] **Define a retention period.** Decide how long test data lives and delete it
      after.

## Tier 2 — Before a public launch / first paying users

Don't do these now — they're the "problem you want to have." Listed so they're
not forgotten.

- [ ] **Full privacy policy** (not just the test notice). *(No analytics or
      cookies are in use — see the PECR item in Tier 0.)*
- [ ] **Children's Code (Age Appropriate Design Code)** review if the service is
      likely to be accessed by children.
- [ ] **Signed DPAs** with all processors (OpenAI ✅, Groq ✅, Supabase, hosting, etc.).
- [ ] **Consider incorporating (Ltd)** for the liability shield once there are
      customers / contracts / revenue / investment. See `NEXT_MOVES.md` context —
      entity is a money-and-users problem, not a month-zero one.
- [ ] **Data breach process** — know how/when to report to the ICO (72 hours).
- [ ] **DPIA** (Data Protection Impact Assessment) — **required** (not just
      "likely"): special-category data about children + automated LLM processing
      trips multiple ICO mandatory-DPIA triggers. Promoted to a Tier 1 item (do
      it when real family data lands); starter document at `DPIA.md`. This Tier 2
      line stays as the reminder to keep it current through to public launch.

---

## TL;DR for the test happening *now*

Fake data where you can · consent + one-screen notice · be able to delete ·
disclose + de-train the LLM. That's proportionate for ~10 parents. The ICO fee
and the heavier stuff kick in when real data and real users do.

**Status (2026-06-16):** Tier 0 complete — consent, privacy notice, self-serve
deletion, LLM disclosure, DPAs (OpenAI executed · Groq auto-incorporated),
training off / Groq ZDR on, no raw input persistence, and no analytics or
cookies (no PECR banner needed). **Special-category data handled early:** the notice now
explicitly names health/religious data and the sign-up consent is explicit
(Art 9 condition), with a no-health-profiling design rule. Ready for the
~10-parent test; the remaining Tier 1 items (ICO fee, written DPIA, retention
period) kick in when real (non-fake) family data is entered — none of them
re-architects storage or requires user 2FA.
