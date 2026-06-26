# Experimentation

> **Self-hosted since 2026-06-26 (ADR-023).** PostHog is gone. Assignment is a
> deterministic hash bucketed against the `experiments` config row; events land in
> the `analytics_events` table; the readout is two Postgres views surfaced in the
> `admin.villageos.co.uk` dashboard (`apps/admin`). The event taxonomy and
> decision rule below are unchanged — only the plumbing moved.

Evals ask *"is the extracted field correct against a golden set?"* — offline, on
inputs we control. Experiments ask what evals can't: *"do real parents act on the
draft, and which fields do they fix?"* — online, on inputs we don't. The eval is a
contract test on model quality; the experiment a behavioural test on product value.
Closing the loop — offline benchmark → online behaviour → better benchmark — is the
point, not a p-value.

> Companion offline report: [`evals/extraction/model_selection.md`](./evals/extraction/model_selection.md).
> **Status: pre-registered design, readout pending** — the hypothesis, metrics, and
> decision rule are fixed *before* looking at data; the results table is a placeholder.

## The live experiment — extraction provider-stack A/B

Control = the proven OpenAI stack, treatment = the cheap single-vendor Groq stack;
one arm serves **both** the text and the vision path (ADR-019).

| Arm | text model | vision model | `instructor` mode |
|---|---|---|---|
| **control** — OpenAI | `gpt-4o-mini` | `gpt-4o` | TOOLS |
| **treatment** — Groq | `llama-4-scout` | `llama-4-scout` | JSON |

Offline the two are field-correctness-equivalent while Groq is cheaper and faster —
most starkly on vision (~1/15th the cost):

| Path | control | treatment |
|---|---|---|
| text | 4/4 dates · 2.20s · $0.27/1k | 4/4 dates · **0.71s** · $0.25/1k |
| vision | golden baseline · ~3s · ~$0.008/img | **19/19** rule checks · **~1s** · **~$0.0005/img** |

**Hypothesis.** Because they're offline-equivalent, users will edit Groq's drafts no
more than OpenAI's. **Decision rule (pre-registered):** adopt `treatment` unless it
**increases** the mean field-edit rate by **≥ 0.5 fields/accepted draft** on either
input type. Treatment is the cheaper *and* faster stack, so cost/latency aren't
guardrails against it — **quality is the only thing that can veto the switch.**

## Metrics

| Metric | Type | Definition | Source |
|---|---|---|---|
| **Fields edited / accepted draft** | **Primary** | mean `n_edited` (+ per-field, split by `input_type`) | `extraction_accepted` |
| **Draft discard rate** | **Primary (negative)** | `extraction_discarded` / `extraction_shown` — a discard is worse than an edit, the sharpest signal at low N | discard / shown |
| Extraction → event conversion | Secondary | `extraction_accepted` / `extraction_shown` | funnel |
| Re-extract rate | Diagnostic | share of `extraction_shown` with `re_extract = true` — dissatisfaction with draft 1 | shown |
| Latency · cost · confidence | Guardrail | `llm_duration_ms`, `total_tokens` ÷ `input_length_chars`, `event.confidence` | `extraction_completed` log |

**Why edit-count, not binary accept-rate, is primary:** a count carries far more
signal per observation than a yes/no, so a direction emerges at a fraction of the
sample — the only honest readout at portfolio traffic. It's also a better quality
proxy (a draft accepted after rewriting title + time is worse than one accepted
untouched), and the per-field breakdown should implicate `start_time`, the field the
offline eval flags on relative dates. The diff is computed in
[`extraction-diff.ts`](../web/src/lib/extraction-diff.ts) at minute precision, so the
`datetime-local` round-trip doesn't read as an edit.

## Events

All events are rows in `analytics_events` (`event`, `distinct_id`, `properties`, `ts`).
`extraction_assigned` is written server-side; the rest are POSTed by the web client
to `/api/analytics/events`, where `distinct_id` is stamped from the JWT `sub`.

| Event | Emitted by | Key properties |
|---|---|---|
| `extraction_assigned` | API (server) | `variant`, `provider`, `model` |
| `extraction_shown` | web (on draft render) | `variant`, `provider`, `model`, `input_type`, `attempt`, `re_extract` |
| `extraction_accepted` | web (on event create) | `variant`, `input_type`, `n_edited`, `edited_fields` |
| `extraction_discarded` | web (on draft discard) | `variant`, `provider`, `model`, `input_type` |

`attempt` is a per-session counter; `re_extract = attempt > 1`. Both reset on
accept/discard.

## How assignment works

- **Server-authoritative.** The arm is chosen in
  [`app/core/experiments.py`](./app/core/experiments.py) for the `extraction-model`
  experiment, keyed on the user (`sub`), and logged (`extraction_assigned`).
  Tamper-proof, survives a web-SDK failure.
- **Deterministic.** A `sha256(sub + experiment key)` bucket is walked against the
  weights in the `experiments` config row, so a user always sees the same arm —
  across extractions and across text/image. Server and client events share the
  same Supabase id as `distinct_id`, so they stitch into one funnel.
- **Config-driven kill-switch.** The `experiments` row (`enabled`, `variants`)
  retunes the split or disables the test with no deploy. Read behind a short TTL
  cache, so it isn't a per-request network call.
- **Disabled-by-default.** Experiment row absent/`enabled = false` (or no Supabase
  service key) ⇒ everyone gets the production default, no captures, no behaviour
  change. Assignment runs *after* the per-tier quota guard, never bypassing it.

## Running it at low traffic

Deterministic assignment locks a single tester to one arm. Reach both by spinning up
**anonymous demo accounts** (ADR-016): each new identity draws a fresh ~50/50 arm and
resets the per-user quota (ADR-017). Run the same inputs (text + real photos) through
several. This data is **self-generated and unpaired**, so read it for *direction
only*. A portfolio app won't reach significance — the readout says so and states the
sample a real decision needs. **The artifact is the correct design, not a significant
result;** a fabricated p-value would be the anti-signal.

## Results *(pending readout)*

| Arm | input_type | n_shown | conv. | discard % | **mean fields edited** |
|---|---|---|---|---|---|
| control (OpenAI) | text / image | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| treatment (Groq) | text / image | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## Reading the results

- **Online:** the **`admin.villageos.co.uk`** dashboard (`apps/admin`), reading
  `GET /api/admin/experiments/extraction` — two Postgres views
  (`experiment_extraction_outcomes`, `experiment_extraction_field_edits`):
  shown-vs-accepted per arm and per-field edit rate. Enable the experiment row and
  capture events first, or the charts read empty.
- **Offline anchor:** re-run the eval and read `llm_duration_ms` /
  `input_length_chars` / `tokens_used` per row in `evals/extraction/results.jsonl`:
  ```bash
  # from apps/api/ with .venv active
  python -m evals.extraction.run \
    --models openai/gpt-4o-mini,groq/meta-llama/llama-4-scout-17b-16e-instruct
  ```
