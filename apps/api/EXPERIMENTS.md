# Experimentation

Evals answer *"is the extracted field correct against a golden set?"* — offline,
on inputs we control. Experiments answer the question evals can't: *"do real
parents act on the draft, and which fields do they fix?"* — online, on inputs we
don't control. The two are a pair: the eval is a **contract test on model
quality**, the experiment is a **behavioural test on product value**. This doc
covers the online half — what we measure and why.

The first live experiment is the extraction **model A/B** (`groq/llama-4-scout`
vs `openai/gpt-4o-mini`); its hypothesis, decision rule, and readout live in
[`evals/experiments/extraction_model_ab.md`](./evals/experiments/extraction_model_ab.md).
This doc is the methodology behind it.

---

## What we measure

| Metric | Type | Definition | Source |
|---|---|---|---|
| **Fields edited / accepted draft** | **Primary** | mean number of `ParentEvent` fields a user changes between the extracted draft and the event they create, plus a per-field breakdown | `extraction_accepted` event |
| Extraction → event conversion | Secondary | `extraction_accepted` / `extraction_shown` per arm | funnel |
| p50 / p95 latency | Guardrail | `llm_duration_ms` per arm | `extraction_completed` server log |
| Tokens / cost per extract | Guardrail | `total_tokens` ÷ `input_length_chars` per arm | `extraction_completed` server log |
| Confidence | Diagnostic | model's self-reported `event.confidence` per arm | `extraction_completed` server log |

---

## Why these, and not the obvious ones

### Primary: field-edit rate, not binary accept-rate

The intuitive metric is *acceptance* — did the draft become an event, yes/no. We
deliberately demote it to secondary, for one reason: **statistical power at low
traffic.**

- A binary (accepted / not) carries little information per observation. To
  detect, say, a 60% → 70% lift you need hundreds of conversions *per arm* — a
  portfolio app never gets there.
- A **count** (how many fields the user had to fix, 0–8) carries far more
  information per observation, so a direction emerges at a fraction of the sample.

It's also a *better proxy for quality*. A draft the user accepts after rewriting
the title, time, and location is a worse extraction than one they accept
untouched — but binary accept-rate scores them identically. Fields-edited
captures that gradient, and the **per-field breakdown** is diagnostic: it should
point at `start_time`, the exact field the offline eval shows is the
discriminator on relative dates like *"next Saturday."*

The diff is computed in [`apps/web/src/lib/extraction-diff.ts`](../web/src/lib/extraction-diff.ts),
comparing the created event against the original draft. Datetimes are compared at
**minute precision** so the form's `datetime-local` round-trip (which drops
seconds) doesn't register as a user edit; blank-vs-null is coalesced; `confidence`
is excluded because the form fixes it to 1.0 on submit.

### Guardrails: latency and cost

A quality win that doubles cost or latency isn't a win. These come **free** — the
extraction pipeline already logs `llm_duration_ms`, `total_tokens`, and
`input_length_chars` on every request (`extraction_completed`). Cost is
normalised **per 1k input chars** so it measures the model's intrinsic
efficiency rather than conflating *"this model is expensive"* with *"this input
was long."*

### The decision rule is pre-registered

Fixed before looking at data: **stay on the incumbent unless the challenger
reduces the mean field-edit rate by a meaningful, pre-set margin without a cost
regression.** Pre-registering it is what keeps the readout honest — no
rationalising a noisy point estimate after the fact.

---

## The offline ↔ online pairing (the point)

The same pipeline is measured two ways — offline on clean golden fixtures, online
on real, messy pastes — so each axis validates the other:

| Axis | Offline (golden set) | Online (real traffic) | What the comparison reveals |
|---|---|---|---|
| **Quality** | field correctness vs labels | fields users *edit* | do they agree? `start_time` should be weakest/most-edited in both; if not, the golden set has a blind spot. |
| **Cost** | tokens ÷ input chars per model | same ratio from prod logs | the **"benchmark reality tax"** — real pastes are longer/messier, so prod cost runs higher than the benchmark predicts. Quantify it. |
| **Latency** | `llm_duration_ms` (eval row) | `llm_duration_ms` (prod log) | same instrument both sides — does the benchmark latency hold under real load? |

The eval runner now records `llm_duration_ms` and `input_length_chars` on every
row (the *identical* instruments production logs), so these comparisons are
computed, not estimated. Compare **distributions, not individual rows** — a real
extraction is never a golden example. Closing this loop (offline benchmark →
online behaviour → better benchmark) is the senior signal, not a p-value.

---

## The honest framing

A product app has low traffic, so this will almost certainly **not reach
statistical significance** — and that's stated plainly in the readout. The
artifact is the *correct design*: a hypothesis tied to a real user metric,
server-authoritative assignment, logged exposures, guardrails, a pre-registered
decision rule, and a readout that says *"underpowered; here's the observed
direction and the sample we'd need."* A fabricated significant result would be
the anti-signal.

---

## How assignment works (so the numbers are trustworthy)

- **Server-authoritative.** The arm is chosen in
  [`app/core/experiments.py`](./app/core/experiments.py) via the PostHog feature
  flag `extraction-model`, keyed on the authenticated user (`user["sub"]`).
  Tamper-proof, works even if the web SDK fails to load, and logged
  (`extraction_assigned`) next to the existing extraction telemetry.
- **Deterministic.** PostHog hashes `sub + flag key`, so a user always sees the
  same arm — no flip-flopping between extractions.
- **One `distinct_id`.** The web SDK `identify()`s with the same Supabase user id,
  so server (`extraction_assigned`) and client (`extraction_shown`,
  `extraction_accepted`) events stitch into one funnel.
- **Disabled-by-default.** No `POSTHOG_API_KEY` ⇒ everyone gets the production
  default, no captures, no behaviour change. The experiment never bypasses the
  per-tier quota guard — assignment runs *after* metering.
- **Vendor-optional.** PostHog buys live control of the split + the analytics
  join; the assignment itself is just a deterministic hash and could run with no
  external service (the readout would then come from server logs).

---

## Event taxonomy

| Event | Emitted by | Key properties |
|---|---|---|
| `extraction_assigned` | API (server, Python SDK) | `$feature/extraction-model`, `provider`, `model` |
| `extraction_shown` | web (on draft render) | `variant`, `provider`, `model` |
| `extraction_accepted` | web (on event create) | `variant`, `n_edited`, `edited_fields` |

## Reading the results

- **Online:** PostHog → a funnel `extraction_shown → extraction_accepted` broken
  down by `variant`, and a trend on the average of `n_edited` by `variant`.
- **Offline anchor:** re-run the eval and read `llm_duration_ms` /
  `input_length_chars` / `tokens_used` per row in
  [`evals/extraction/results.jsonl`](./evals/extraction/results.jsonl).

See [`evals/experiments/extraction_model_ab.md`](./evals/experiments/extraction_model_ab.md)
for the live experiment's hypothesis, variant table, and readout.
