# Extraction — Model Selection

Consolidates findings from prompt v1 vs v2 sweeps and TOOLS vs JSON mode sweeps
on the parent-event extraction pipeline. All results assume **prompt v2** and
the per-provider preferred mode listed below.

**Frozen today for all evals:** 2026-05-10 (Sunday). Cases live in `tests/golden/`.

## ✓ Production-quality models

These passed every test we could run, are responsive, and cost-reasonable.
Each row uses the mode it's most reliable in.

| Provider/Model                                     | Mode  | Date pass rate     | Avg latency | Avg cost / 1k | Why this combo               |
|----------------------------------------------------|-------|--------------------|-------------|---------------|------------------------------|
| **groq/meta-llama/llama-4-scout-17b-16e-instruct** | JSON  | 4/4                | **0.71s**   | **$0.25**     | Fastest viable + cheapest    |
| openai/gpt-4o-mini                                 | TOOLS | 4/4                | 2.20s       | $0.27         | Most reliable cheap fallback |
| groq/openai/gpt-oss-20b                            | JSON  | 4/4                | 1.02s       | $0.56         | Backup if scout regresses    |
| openai/gpt-4o                                      | TOOLS | 4/4                | 1.50s       | $5.17         | Use only when mini fails     |

**Default app config** (`apps/api/app/services/extraction.py`):
- `LLM_PROVIDER=openai` → `gpt-4o-mini` in TOOLS mode
- `LLM_PROVIDER=groq` → `llama-4-scout-17b` in JSON mode (escalation disabled)

## ✗ Not recommended

| Provider/Model                | Mode      | Date pass rate            | Avg latency      | Avg cost / 1k | Why not                                                                 |
|-------------------------------|-----------|---------------------------|------------------|---------------|--------------------------------------------------------------------------|
| groq/llama-3.1-8b-instant     | JSON      | 2/4 (flaky)               | 0.4s – 35s ⚠     | $0.09         | Cheapest but date is non-deterministic; sometimes returns 2024 dates    |
| groq/llama-3.1-8b-instant     | TOOLS     | n/a                       | n/a              | n/a           | Schema validation fails (omits required fields)                          |
| groq/llama-3.3-70b-versatile  | JSON      | 3/4                       | 0.55s            | $1.04         | Always mis-resolves "next Saturday" → 2026-05-17; +5x cost vs scout     |
| groq/qwen/qwen3-32b           | JSON      | 3/4 (fails relative date) | ~2–4s (fast)¹    | $1.16         | Same date bug as 70b on `_adhoc_football`                                |
| groq/qwen/qwen3-32b           | TOOLS     | 2/2 (small sample)        | ~1.3s (fast)¹    | $0.82         | Date OK in TOOLS, but latency not currently testable¹                    |

¹ Latency for qwen3-32b on Groq is currently being throttled — individual calls
spike to 20–45s on the queue. The numbers above show the *fast-path* latency
when not throttled; true sustained latency can't be measured reliably right now.

## Why date extraction is the discriminator

All four golden cases test broadly the same fields, but only `_adhoc_football`
("under-9s football tournament next Saturday") forces the model to resolve a
relative weekday. Every other field (title, event_type, is_all_day, action
items by keyword) passes on every model in the matrix. Differences in this
report are almost entirely about whether the model gets `start_time` right.

## Current eval setup

- **Pipeline:** `instructor` library + `ParentEvent` Pydantic schema, async
  OpenAI-compatible client per provider. Source: `apps/api/app/services/extraction.py`.
- **Prompt:** `apps/api/app/prompts/extraction/v2.py` (current version).
  v1 retained for regression comparisons.
- **Golden cases:** `apps/api/tests/golden/*.{txt,json}`. Each `.json` carries
  expected `event_type`, `start_time` or `start_date`, `is_all_day`, and
  optional `action_items_keywords` (list of substrings that must all appear in
  the joined action-item descriptions, case-insensitive).
- **Reports:** `apps/api/evals/extraction/results.md` (append-only history).

### How to run

From `apps/api/` with `.venv` active:

```bash
# Default matrix (production + research candidates), all golden cases, current prompt
python -m evals.extraction.run

# Single model, single case, don't append
python -m evals.extraction.run \
  --models groq/meta-llama/llama-4-scout-17b-16e-instruct \
  --cases _adhoc_football \
  --no-append

# Compare prompt versions side-by-side
python -m evals.extraction.run --prompt-versions v1,v2

# Force a specific instructor mode for ALL entries (overrides per-entry default)
python -m evals.extraction.run --mode JSON
```

Useful flags:
- `--models provider/model[,provider/model]` — restrict the matrix
- `--cases case_id[,case_id]` — restrict to specific golden cases (use `.txt` stem)
- `--prompt-versions v1[,v2]` — sweep prompt versions
- `--mode TOOLS|JSON` — override instructor mode globally
- `--no-append` — print only, don't write to `results.md`
- `--notes "..."` — annotate the run header in `results.md`

### Open gaps

- **8b's date non-determinism** isn't fixable via prompting. Either drop it,
  pre/post-process dates with `dateparser`, or lower temperature.
- **70b's "next Saturday" → +7 days bug** persists across v1 and v2 prompts.
  A v3 prompt could try a worked example using the actual frozen-today value.
