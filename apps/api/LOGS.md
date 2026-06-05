# Observability — CloudWatch Logs Insights

The API emits **structured JSON logs** to stdout. On Lambda, stdout is forwarded
to the log group `/aws/lambda/villageos-api-*`, where each JSON line becomes a
set of queryable fields in CloudWatch Logs Insights.

Two log events carry the useful signal:

| Event | Emitted by | Key fields |
|---|---|---|
| `request_completed` | `RequestContextMiddleware` (every request) | `method`, `path`, `status`, `duration_ms`, `request_id` |
| `extraction_completed` | `extraction.extract_event` (per LLM extraction) | `model`, `provider`, `llm_duration_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `confidence`, `input_length_chars`, `request_id` |
| `extraction_prompt` | `extraction.extract_event`, **DEBUG only** | full `messages` array sent to the model (system prompt + user text); logged *before* the LLM call so it survives a failed request |
| `extraction_result` | `extraction.extract_event`, **DEBUG only** | full extracted event payload under `result` (user content — emitted only when `LOG_LEVEL=DEBUG`) |
| `extract_metered` | `extract` route (per quota'd extract, before the LLM call) | `tier`, `daily_count`, `request_id` |
| `quota_exceeded` | `extract` route (per-identity daily cap exceeded → `429`) | `tier`, `request_id` |
| `demo_session_started` | `demo` route (first seed of a guest's calendar) | `user_id` (guest sub), `request_id` |
| `demo_seeded` | `demo` route (seed inserted rows) | `event_count`, `request_id` |

`extract_metered` fires once per metered call (tiers with a `daily_cap`), after
the atomic counter increment and *before* the model runs, so `daily_count` is the
caller's post-increment total for the day. Unlimited tiers (`pro`) skip metering
and emit no `extract_metered`. `quota_exceeded` replaces it when the increment
pushes the caller past the cap; the LLM never fires on that request. Both carry
`tier`, so the funnel below splits cleanly by account type (`demo` / `free` /
`pro`).

### Error events

| Event | Level | Emitted by | Key fields |
|---|---|---|---|
| `request_failed` | ERROR | `RequestContextMiddleware` (any unhandled exception) | `method`, `path`, `duration_ms`, `request_id`, plus stack trace |
| `extraction_failed` | ERROR | `extract` route (extraction raised) | `path`, `request_id`, plus stack trace |
| `auth_failed` | WARNING | `auth.get_auth` (invalid JWT) | `request_id`, `reason` |

`request_failed` is the catch-all — any exception that reaches the middleware is
logged here with a stack trace. `extraction_failed` is the more specific line for
a failed LLM extraction (the same call also surfaces as a `request_failed` once
the 500 propagates). Expired tokens are **not** logged — they return a `401`
silently, since an aged-out token is routine rather than a fault. All three carry
`request_id`, so an error joins cleanly to its `request_completed` /
`extraction_completed` lines for the same call.

`request_id` is shared between the two events for a given call (and echoed to the
client as the `x-request-id` response header), so an access-log line can be
joined to its extraction telemetry.

---

## Canonical queries

Open **CloudWatch → Logs → Logs Insights**, select the
`/aws/lambda/villageos-api-*` log group, and paste a query below.

### p50 / p95 / p99 latency on extract

```sql
fields @timestamp, duration_ms
| filter path = "/api/extract"
| stats avg(duration_ms), pct(duration_ms, 50), pct(duration_ms, 95), pct(duration_ms, 99)
```

### Token consumption by model

```sql
fields @timestamp, model, total_tokens
| filter event = "extraction_completed"
| stats sum(total_tokens), avg(total_tokens), count(*) by model
```

### LLM latency by model (the escalation cost)

```sql
fields @timestamp, model, llm_duration_ms
| filter event = "extraction_completed"
| stats avg(llm_duration_ms), pct(llm_duration_ms, 95) by model
```

### Recent errors with request IDs for triage

```sql
fields @timestamp, request_id, event, path, @message
| filter event = "request_failed" or event = "extraction_failed"
| sort @timestamp desc
| limit 20
```

### Auth failures (rejected tokens)

```sql
fields @timestamp, request_id, reason
| filter event = "auth_failed"
| stats count(*) by reason
```

### Low-confidence extractions (prompt-quality signal)

```sql
fields @timestamp, request_id, model, confidence, input_length_chars
| filter event = "extraction_completed" and confidence < 0.7
| sort @timestamp desc
| limit 20
```

### Quota funnel by tier (metered extracts vs. limit hits)

How many extracts each tier ran and how many were rejected at the cap — the
demo cost-guard signal. A rising `limited` share for `demo` means guests are
hitting the wall (and seeing the "sign up" CTA):

```sql
fields @timestamp, tier, event
| filter event = "extract_metered" or event = "quota_exceeded"
| stats count(*) as total,
        sum(event = "extract_metered") as metered,
        sum(event = "quota_exceeded") as limited
    by tier
```

### Demo funnel (sessions → extracts → limit hits)

The guest journey in one query — how many demos started, how many extractions
those guests ran, and how many hit the cap. A healthy demo has extracts ≫
sessions (guests trying the product) with a small `limited` tail:

```sql
fields @timestamp, event
| filter event in ["demo_session_started", "extract_metered", "quota_exceeded"]
| stats sum(event = "demo_session_started") as sessions,
        sum(event = "extract_metered" and tier = "demo") as demo_extracts,
        sum(event = "quota_exceeded" and tier = "demo") as demo_limited
    by bin(1d)
```

### Trace one request end-to-end

Paste a request ID (from the `x-request-id` response header or an error report):

```sql
fields @timestamp, event, path, status, duration_ms, model, total_tokens, confidence
| filter request_id = "PASTE_REQUEST_ID_HERE"
| sort @timestamp asc
```

---

### Inspect the exact prompt sent to the model (DEBUG only)

The most direct debugging view — what the LLM actually received. Pair it with the
`extraction_result` for the same `request_id` to see prompt-in / event-out:

```sql
fields @timestamp, request_id, model, messages.1.content
| filter event = "extraction_prompt"
| sort @timestamp desc
| limit 20
```

(`messages.0` is the system prompt, `messages.1` is the user's pasted text.)

### Inspect extracted payloads (DEBUG only)

Requires the function running with `LOG_LEVEL=DEBUG` — off by default because the
payload is user content. Once enabled:

```sql
fields @timestamp, request_id, result.title, result.event_type, result.confidence
| filter event = "extraction_result"
| sort @timestamp desc
| limit 20
```

---

## Notes

- `extraction_prompt` and `extraction_result` (the full prompt and the full
  payload) are gated behind `LOG_LEVEL=DEBUG`; the always-on
  `extraction_completed` line carries only safe metadata. Set the `LOG_LEVEL` env
  var on the Lambda (or locally) to `DEBUG` to turn them on.
- The extract route is mounted at `/api/extract` (not `/api/v1/extract` — there
  is no API version prefix yet).
- `duration_ms` is total request wall-clock; `llm_duration_ms` is just the
  provider call(s). On a low-confidence escalation, `llm_duration_ms` covers
  both the fast-model and smart-model calls.
- See [ADR-014](../../ADL.md#adr-014--structured-logging--observability) for the
  design rationale and what was deliberately left out.
