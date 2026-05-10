# VillageOS — Extraction Eval Results

---

## Run: 2026-05-10 18:32

**Pipeline:** instructor + structured ParentEvent extraction (Mode.TOOLS)  
**Prompt versions:** v1  
**Models:** openai/gpt-4o-mini, openai/gpt-4o, groq/llama-3.3-70b-versatile, groq/llama-3.1-8b-instant  
**Cases:** 01_bake_sale, 02_school_meeting, 03_birthday_party  
**Frozen today:** 2026-05-10

### Summary

| Provider/Model | Prompt | Cases passed | Avg tokens | Avg latency | Avg cost |
| --- | --- | --- | --- | --- | --- |
| openai/gpt-4o-mini | v1 | 3/3 | 1219 | 3.09s | $0.2208/1k |
| openai/gpt-4o | v1 | 3/3 | 1216 | 1.71s | $3.6508/1k |
| groq/llama-3.3-70b-versatile | v1 | 3/3 | 1520 | 0.54s | $0.9187/1k |
| groq/llama-3.1-8b-instant | v1 | 2/3 | 1516 | 8.85s | $0.0791/1k |

### 01_bake_sale

**openai/gpt-4o-mini · prompt v1** — ✓ · 1236 tokens · 3.27s · $0.2263/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

**openai/gpt-4o · prompt v1** — ✓ · 1227 tokens · 1.72s · $3.6825/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

**groq/llama-3.3-70b-versatile · prompt v1** — ✓ · 1536 tokens · 0.53s · $0.9290/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

**groq/llama-3.1-8b-instant · prompt v1** — ❌ error: `InstructorRetryException: <failed_attempts>

<generation number="1">
<exception>
    Error code: 400 - {'error': {'message': "Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details.", 'type': 'invalid_request_error', 'code': 'tool_use_failed', 'failed_generation': '<function=ParentEvent> {"title": "Bake Sale", "event_type": "fundraiser", "start_time": "2026-05-22T15:00:00", "end_time": null, "location": "school hall", "description": "Bake sale to raise funds for the new library", "action_items": [{"description": "Bring £2 in a labelled envelope", "cost_estimate_gbp": 2.00, "urgent": false}], "confidence": 0.9}'}}
</exception>
<completion>
    None
</completion>
</generation>

<generation number="2">
<exception>
    Error code: 400 - {'error': {'message': "tool call validation failed: parameters for tool ParentEvent did not match schema: errors: [`/start_time`: '2026-05-22T15:00' is not valid 'date-time']", 'type': 'invalid_request_error', 'code': 'tool_use_failed', 'failed_generation': '<function=ParentEvent> {"confidence": 0.8, "action_items": [{"description": "Bring 2 GBP in a labelled envelope", "cost_estimate_gbp": 2.0}, {"description": "Proceeds go to the new library fund"}], "location": "school hall", "event_type": "fundraiser", "start_time": "2026-05-22T15:00", "end_time": null, "title": "Year 3 Bake Sale", "description": "Year 3 Bake Sale for the new library fund", "is_all_day": false} </function>'}}
</exception>
<completion>
    None
</completion>
</generation>

</failed_attempts>

<last_exception>
    Error code: 400 - {'error': {'message': "tool call validation failed: parameters for tool ParentEvent did not match schema: errors: [`/start_time`: '2026-05-22T15:00' is not valid 'date-time']", 'type': 'invalid_request_error', 'code': 'tool_use_failed', 'failed_generation': '<function=ParentEvent> {"confidence": 0.8, "action_items": [{"description": "Bring 2 GBP in a labelled envelope", "cost_estimate_gbp": 2.0}, {"description": "Proceeds go to the new library fund"}], "location": "school hall", "event_type": "fundraiser", "start_time": "2026-05-22T15:00", "end_time": null, "title": "Year 3 Bake Sale", "description": "Year 3 Bake Sale for the new library fund", "is_all_day": false} </function>'}}
</last_exception>`

### 02_school_meeting

**openai/gpt-4o-mini · prompt v1** — ✓ · 1216 tokens · 2.93s · $0.2125/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | school | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

**openai/gpt-4o · prompt v1** — ✓ · 1213 tokens · 0.99s · $3.5125/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | school | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

**groq/llama-3.3-70b-versatile · prompt v1** — ✓ · 1525 tokens · 0.56s · $0.9199/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | meeting | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

**groq/llama-3.1-8b-instant · prompt v1** — ✓ · 1526 tokens · 17.13s · $0.0794/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | meeting | ✓ |
| confidence>=0.7 | >= 0.7 | 1.0 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

### 03_birthday_party

**openai/gpt-4o-mini · prompt v1** — ✓ · 1206 tokens · 3.08s · $0.2237/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie's 7th Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

**openai/gpt-4o · prompt v1** — ✓ · 1209 tokens · 2.42s · $3.7575/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie's 7th Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

**groq/llama-3.3-70b-versatile · prompt v1** — ✓ · 1500 tokens · 0.54s · $0.9072/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie's Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

**groq/llama-3.1-8b-instant · prompt v1** — ✓ · 1507 tokens · 0.56s · $0.0789/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 1.0 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items | >= 1 | 1 | ✓ |

### Findings

- **gpt-4o-mini wins on cost-per-quality** — same 3/3 as gpt-4o at ~17× cheaper ($0.22 vs $3.65 / 1k calls). No reason to use gpt-4o for this task on the current dataset.
- **groq/llama-3.3-70b is the fastest passing model** — 0.54s vs gpt-4o-mini's 3.09s (~6× faster), still 3/3, costs $0.92/1k. ~4× more than mini but ~4× cheaper than 4o; worth it if latency matters for the UX.
- **groq/llama-3.1-8b-instant is unreliable for structured extraction** — failed `01_bake_sale` by emitting `"start_time": "2026-05-22T15:00"` (no seconds, not RFC 3339). Two `instructor` retries didn't recover. Cheap ($0.08/1k) but not safe to ship without a coercion layer. Also one 17s spike on `02_school_meeting` — likely Groq queue blip, not the model.
- **Average tokens ~1500** dominated by the ~1.3k-token system prompt. User text is small. If cost matters more, prompt-shrinking has more leverage than swapping models.
- **Dataset is tiny (3 cases)** — these conclusions are directional. Add adversarial/edge cases (relative-date quirks, multi-event WhatsApp threads, ambiguous times) before treating any of this as conclusive.

### Decision

Stay on **openai/gpt-4o-mini** as default. Revisit if (a) latency complaints surface (→ try groq/llama-3.3-70b) or (b) the corpus grows enough to expose a quality gap mini can't close.

---

## Run: 2026-05-10 20:05

**Pipeline:** instructor + structured ParentEvent extraction (Mode.TOOLS)  
**Prompt versions:** v2  
**Models:** groq/meta-llama/llama-4-scout-17b-16e-instruct  
**Cases:** 01_bake_sale, 02_school_meeting, 03_birthday_party, _adhoc_football  
**Instructor mode:** JSON  
**Frozen today:** 2026-05-10

> scout JSON full 4-case run per model_selection.md open gap

### Summary

| Provider/Model | Prompt | Cases passed | Avg tokens | Avg latency | Avg cost |
| --- | --- | --- | --- | --- | --- |
| groq/meta-llama/llama-4-scout-17b-16e-instruct | v2 | 4/4 | 2025 | 0.71s | $0.2522/1k |

### 01_bake_sale

**groq/meta-llama/llama-4-scout-17b-16e-instruct · prompt v2** — ✓ · 2024 tokens · 0.96s · $0.2484/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items_keywords | all of: ['£2', 'envelope'] | got: bring £2 in a labelled envelope | ✓ |

### 02_school_meeting

**groq/meta-llama/llama-4-scout-17b-16e-instruct · prompt v2** — ✓ · 2019 tokens · 0.54s · $0.2458/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | school | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

### 03_birthday_party

**groq/meta-llama/llama-4-scout-17b-16e-instruct · prompt v2** — ✓ · 2000 tokens · 0.53s · $0.2476/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie's Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items_keywords | all of: ['rsvp'] | got: rsvp by thursday | ✓ |

### _adhoc_football

**groq/meta-llama/llama-4-scout-17b-16e-instruct · prompt v2** — ✓ · 2058 tokens · 0.79s · $0.2669/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Under-9s Football Tournament | ✓ |
| event_type | ['sport'] | sport | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T09:00:00 (±30m) | 2026-05-16T09:00:00 | ✓ |
| action_items_keywords | all of: ['shin', 'boots', '£5'] | got: bring shin pads | bring boots | pay entry fee £5 per child | ✓ |

---

## Run: 2026-05-10 20:08

**Pipeline:** instructor + structured ParentEvent extraction (Mode.TOOLS)  
**Prompt versions:** v2  
**Models:** groq/openai/gpt-oss-20b  
**Cases:** 01_bake_sale, 02_school_meeting, 03_birthday_party, _adhoc_football  
**Instructor mode:** JSON  
**Frozen today:** 2026-05-10

> gpt-oss-20b JSON full 4-case run per model_selection.md open gap

### Summary

| Provider/Model | Prompt | Cases passed | Avg tokens | Avg latency | Avg cost |
| --- | --- | --- | --- | --- | --- |
| groq/openai/gpt-oss-20b | v2 | 4/4 | 2682 | 1.02s | $0.5562/1k |

### 01_bake_sale

**groq/openai/gpt-oss-20b · prompt v2** — ✓ · 2551 tokens · 1.03s · $0.4847/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items_keywords | all of: ['£2', 'envelope'] | got: bring £2 in a labelled envelope | ✓ |

### 02_school_meeting

**groq/openai/gpt-oss-20b · prompt v2** — ✓ · 3128 tokens · 1.42s · $0.7716/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | school | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

### 03_birthday_party

**groq/openai/gpt-oss-20b · prompt v2** — ✓ · 2527 tokens · 0.81s · $0.4863/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie’s 7th Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 0.9 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items_keywords | all of: ['rsvp'] | got: rsvp by thursday | ✓ |

### _adhoc_football

**groq/openai/gpt-oss-20b · prompt v2** — ✓ · 2522 tokens · 0.83s · $0.4822/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Under-9s Football Tournament | ✓ |
| event_type | ['sport'] | sport | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T09:00:00 (±30m) | 2026-05-16T09:00:00 | ✓ |
| action_items_keywords | all of: ['shin', 'boots', '£5'] | got: bring shin pads | bring boots | pay £5 per child | ✓ |

---

## Run: 2026-05-10 20:10

**Pipeline:** instructor + structured ParentEvent extraction (Mode.TOOLS)  
**Prompt versions:** v2  
**Models:** groq/qwen/qwen3-32b  
**Cases:** 01_bake_sale, 02_school_meeting, 03_birthday_party, _adhoc_football  
**Instructor mode:** JSON  
**Frozen today:** 2026-05-10

> qwen3-32b JSON full 4-case re-check

### Summary

| Provider/Model | Prompt | Cases passed | Avg tokens | Avg latency | Avg cost |
| --- | --- | --- | --- | --- | --- |
| groq/qwen/qwen3-32b | v2 | 3/4 | 2950 | 13.04s | $1.1649/1k |

### 01_bake_sale

**groq/qwen/qwen3-32b · prompt v2** — ✓ · 2315 tokens · 43.54s · $0.7853/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items_keywords | all of: ['£2', 'envelope'] | got: bring £2 in a labelled envelope | ✓ |

### 02_school_meeting

**groq/qwen/qwen3-32b · prompt v2** — ✓ · 3756 tokens · 4.20s · $1.6352/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Parent-Teacher Conference Day | ✓ |
| event_type | ['school', 'meeting'] | meeting | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | True | True | ✓ |
| start_date | 2026-06-05 | 2026-06-05 | ✓ |

### 03_birthday_party

**groq/qwen/qwen3-32b · prompt v2** — ✓ · 2845 tokens · 2.16s · $1.1077/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Sophie's 7th Birthday Party | ✓ |
| event_type | ['birthday'] | birthday | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T14:00:00 (±30m) | 2026-05-16T14:00:00 | ✓ |
| action_items_keywords | all of: ['rsvp'] | got: rsvp by thursday to confirm attendance | ✓ |

### _adhoc_football

**groq/qwen/qwen3-32b · prompt v2** — ✗ · 2886 tokens · 2.26s · $1.1312/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Under-9s Football Tournament | ✓ |
| event_type | ['sport'] | sport | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T09:00:00 (±30m) | 2026-05-17T09:00:00 | ✗ |
| action_items_keywords | all of: ['shin', 'boots', '£5'] | got: bring shin pads | bring boots | pay £5 entry fee on the day | ✓ |

---

## Run: 2026-05-10 20:11

**Pipeline:** instructor + structured ParentEvent extraction (Mode.TOOLS)  
**Prompt versions:** v2  
**Models:** groq/qwen/qwen3-32b  
**Cases:** 01_bake_sale, _adhoc_football  
**Instructor mode:** TOOLS  
**Frozen today:** 2026-05-10

> qwen3-32b TOOLS 2-case re-check (incl. relative-date case)

### Summary

| Provider/Model | Prompt | Cases passed | Avg tokens | Avg latency | Avg cost |
| --- | --- | --- | --- | --- | --- |
| groq/qwen/qwen3-32b | v2 | 2/2 | 2310 | 12.65s | $0.8184/1k |

### 01_bake_sale

**groq/qwen/qwen3-32b · prompt v2** — ✓ · 2308 tokens · 24.03s · $0.8127/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Year 3 Bake Sale | ✓ |
| event_type | ['fundraiser', 'school'] | fundraiser | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-22T15:00:00 (±30m) | 2026-05-22T15:00:00 | ✓ |
| action_items_keywords | all of: ['£2', 'envelope'] | got: bring £2 in a labelled envelope | ✓ |

### _adhoc_football

**groq/qwen/qwen3-32b · prompt v2** — ✓ · 2312 tokens · 1.26s · $0.8241/1k

| field | expected | actual | ✓ |
| --- | --- | --- | --- |
| title_nonempty | non-empty, not raw input | Under-9s Football Tournament | ✓ |
| event_type | ['sport'] | sport | ✓ |
| confidence>=0.7 | >= 0.7 | 0.95 | ✓ |
| is_all_day | False | False | ✓ |
| start_time | 2026-05-16T09:00:00 (±30m) | 2026-05-16T09:00:00 | ✓ |
| action_items_keywords | all of: ['shin', 'boots', '£5'] | got: bring shin pads | bring boots | pay £5 entry fee on the day | ✓ |

---

