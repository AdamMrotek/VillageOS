# Experimentation — plan (not yet built)

> **Status: proposed.** The previous self-hosted A/B stack was removed in
> [ADR-025](../../ADL.md) when the model roster changed. This is the sketch for
> bringing experimentation back if/when we need it — a clean rebuild, not a
> revival of the old code.

## Goal

Measure whether a change to extraction (model, prompt, provider) actually makes
drafts *better for real parents*, online, on inputs we don't control — the
question evals can't answer offline.

## Shape

- **Dynamic / config-driven.** An experiment is a DB config row (`enabled`,
  `variants` weight map, `default`), read behind a short cache. Flipping it on/off
  or retuning the split is a row edit, **no deploy**. Disabled ⇒ everyone gets the
  production default, byte-for-byte.
- **Split users by hash.** Assignment is a deterministic `sha256(user_id + key)`
  bucket walked against the variant weights — server-side and stable, so a user
  keeps their arm across every extraction and both text/image paths. No SDK, no
  network call in the hot path beyond the cached config read.
- **Two primary metrics.**
  - **Acceptance rate** — `accepted / shown` per arm (did the draft get kept?).
  - **Field-edit rate** — mean fields changed between draft and created event,
    with a per-field breakdown (which fields each arm gets wrong). A count carries
    more signal per observation than a binary — the honest readout at low traffic.
- **Guardrails** — latency and cost per extraction, straight off the existing
  `extraction_completed` log.

## Pieces to build

1. Config table + assignment helper (hash bucket + kill-switch cache).
2. Event sink for the funnel (`shown` / `accepted` / `discarded`), `distinct_id`
   stamped server-side from the JWT.
3. Readout (per-arm acceptance + per-field edit rate) surfaced on the admin app.
