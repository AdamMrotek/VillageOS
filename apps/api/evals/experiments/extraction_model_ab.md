# Online Experiment — Extraction Model A/B (control = Scout, treatment = gpt-4o-mini)

> Companion to the offline [`evals/extraction/model_selection.md`](../extraction/model_selection.md).
> That report ranks models on **field correctness against a golden set**; this one
> measures whether real users **act on and correct** the drafts those models
> produce. The pairing is the point.
>
> **Status: pre-registered design — readout pending.** The hypothesis, metrics,
> and decision rule below are fixed *before* looking at data; result tables are
> placeholders to fill at readout. Design correctness is the artifact, not a
> p-value (a portfolio app will almost certainly be underpowered — see §6).

---

## 1. Hypothesis & decision rule

Production already runs the **cheap, fast incumbent**: `LLM_PROVIDER=groq` →
`llama-4-scout` in JSON mode (`app/core/tiers.py` pins `model: None`, i.e. the
provider default). Offline, Scout and gpt-4o-mini are near-equivalent — **both
4/4 on the date cases, ~equal cost/1k** — and Scout is **~3× faster**:

| | offline date pass | avg latency | avg cost / 1k |
|---|---|---|---|
| `groq/llama-4-scout` (control) | 4/4 | **0.71s** | $0.25 |
| `openai/gpt-4o-mini` (treatment) | 4/4 | 2.20s | $0.27 |

*Source: `model_selection.md`. gpt-4o-mini is modestly pricier per token and the
slower of the two; it is the widely-trusted "safe" cheap model.*

**H1.** Because the two are offline-equivalent on field correctness, real users
will edit Scout's drafts **no more often** than gpt-4o-mini's. If that holds, we
have *behavioural* evidence to stay on the faster incumbent. If gpt-4o-mini's
reputation translates into materially fewer edits, we've quantified what Scout's
speed costs us in real use.

**Decision rule (pre-registered).** Stay on `control` (Scout) unless `treatment`
**reduces** the mean field-edit rate by **≥ 0.5 fields/accepted draft** *and*
without a cost regression beyond +20% / 1k. Otherwise hold. If underpowered,
report the observed direction and the sample size required to power the primary
metric; do **not** ship on a noisy point estimate.

---

## 2. Design

- **Unit of assignment:** the authenticated user (`user["sub"]`). Deterministic,
  so a user always sees the same arm across extractions.
- **Arms:** `control = groq/llama-4-scout`, `treatment = openai/gpt-4o-mini`, 50/50
  via the PostHog feature flag **`extraction-model`** (variants keyed exactly
  `control` / `treatment`).
- **Isolation:** both arms are **pinned** (provider + model passed explicitly),
  which disables the low-confidence escalation, so each arm is exactly one model.
  Per-provider `instructor` mode (Scout→JSON, gpt-4o-mini→TOOLS) is resolved
  automatically. This is a **holistic provider A/B** (provider + model + cost +
  latency move together) — the right frame for a deployment decision, not a
  single-factor causal claim.
- **Assignment is server-authoritative** (`app/core/experiments.py`): tamper-proof,
  survives a web-SDK failure, and logged next to the existing `extraction_completed`
  telemetry so server logs and PostHog agree. Metering (429 / tier quota) runs
  *before* assignment and is never bypassed.

### Event taxonomy

| Event | Where | Key properties |
|---|---|---|
| `extraction_assigned` | API (server) | `$feature/extraction-model`, `provider`, `model` |
| `extraction_shown` | web `events/new` (extract success) | `variant`, `provider`, `model` |
| `extraction_accepted` | web `events/new` (create success) | `variant`, `n_edited`, `edited_fields[]` |

`n_edited` / `edited_fields` come from a per-field diff of the created event vs the
extracted draft (`apps/web/src/lib/extraction-diff.ts`); datetimes are compared at
minute precision so the form's `datetime-local` round-trip doesn't read as an edit.

---

## 3. Metrics

| Metric | Type | Definition | Source |
|---|---|---|---|
| **Fields edited / accepted draft** | **Primary** | mean `n_edited`, + per-field rate | `extraction_accepted` |
| Extraction→event conversion | Secondary | `extraction_accepted` / `extraction_shown` per arm | funnel |
| p50 / p95 latency | Guardrail | `llm_duration_ms` per arm | `extraction_completed` log |
| Tokens / cost per extract | Guardrail | `total_tokens` ÷ `input_length_chars` per arm | `extraction_completed` log |
| Confidence | Diagnostic | `event.confidence` per arm | `extraction_completed` log |

**Why edit-rate, not binary accept-rate, is primary:** a count carries far more
information per observation than a binary, so a direction emerges at much smaller
N — the only honest way to get signal at portfolio traffic. The per-field
breakdown is also diagnostic: it should point at `start_time`, the field
`model_selection.md` shows is the discriminator offline.

---

## 4. Results — variant table *(pending readout)*

| Arm | n_shown | n_accepted | conv. | **mean fields edited** | p95 latency | cost / 1k |
|---|---|---|---|---|---|---|
| control (Scout) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| treatment (gpt-4o-mini) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

Per-field edit rate *(pending)*: `start_time`, `end_time`, `title`, `event_type`,
`location`, `description`, `is_all_day`, `action_items`.

---

## 5. Offline ↔ online validation (three axes)

The headline. The same pipeline is measured two ways — offline on clean golden
fixtures, online on real, messy pastes — so each axis validates the other.

| Axis | Offline (golden set) | Online (real traffic) | What the comparison tells you |
|---|---|---|---|
| **Quality** | field correctness vs labels (Scout & mini both 4/4) | fields users *edit* (`n_edited`, per-field) | do they agree? `start_time` should be weakest/most-edited in both; disagreement = a gap in the golden set. |
| **Cost** | `tokens_used` ÷ `input_length_chars` per model | same ratio from `extraction_completed` | the **"benchmark reality tax"**: real pastes are longer/messier, so prod tokens/char runs *higher* than the golden set predicts — quantify by how much. |
| **Latency** | `llm_duration_ms` (eval row) | `llm_duration_ms` (prod log) | same instrument both sides; does Scout's offline ~0.71s hold under real load? |

The offline eval now records `llm_duration_ms` + `input_length_chars` on every
row (`ExtractionRunDetails` → `results.jsonl`), the **identical** instruments the
production log emits — so the cost/latency rows above are computable, not
estimated. Compare **distributions, not individual rows** (real extractions
aren't golden examples), and read the online side as directional given small N.

---

## 6. Readout *(template — fill at decision time)*

- **Observed direction:** control vs treatment on mean fields edited = _TBD_.
- **Significance:** _e.g._ "n_control = X, n_treatment = Y; **underpowered** — the
  95% CI on the difference spans zero."
- **Required sample:** to power the primary metric at the pre-set 0.5-field effect
  (α=0.05, power=0.8) we'd need ≈ _N_ accepted drafts/arm — vs the _X_ we have.
- **Three-axis check:** did online quality/cost/latency agree with offline? _TBD_.
- **Decision:** stay on Scout / switch to gpt-4o-mini, per §1's rule. _TBD_.

> If underpowered (the expected outcome), that is the honest result: the
> methodology is sound and the readout states what sample a real decision needs.
> A fabricated significant result would be the anti-signal.

---

## 7. How this differs from the offline eval

`model_selection.md` asks *"is the extracted field correct against a labelled
golden set?"* — a fixed, ~30-case benchmark we control. This experiment asks
*"do real parents accept the draft, and which fields do they fix?"* — a moving
target driven by real inputs we don't control. The first is a **contract test on
model quality**; the second is a **behavioural test on product value**. Neither
substitutes for the other: a model can ace the golden set and still produce
drafts users rewrite (input drift, fields the golden set doesn't cover), and the
edit-rate's per-field breakdown feeds straight back into *what golden cases to add
next*. Closing that loop — offline benchmark → online behaviour → better
benchmark — is the senior artifact.

---

## 8. How to read it

- **Online:** PostHog (free tier) → Insights → funnel `extraction_shown` →
  `extraction_accepted`, broken down by `variant`; trend on `n_edited` by `variant`.
- **Offline:** re-run the anchor and inspect the new columns —
  ```bash
  # from apps/api/ with .venv active
  python -m evals.extraction.run \
    --models groq/meta-llama/llama-4-scout-17b-16e-instruct,openai/gpt-4o-mini
  ```
  then read `llm_duration_ms` / `input_length_chars` / `tokens_used` per row in
  `evals/extraction/results.jsonl` (or the `apps/eval-viewer`).
