"""LLM-as-judge grader for extraction eval runs.

A separate, fixed grader model (default openai/gpt-4o) reads each extraction
result and returns a 1–10 score with strengths / weaknesses / explanation.

The grader is scoped to three qualitative fields only:
  - title
  - description
  - action_items

Everything else (type, time, location, confidence) is left to the rule-based
checks and is intentionally not surfaced to the grader.

Never grade with the same model that produced the output — that's the
self-preference trap. The grader model is intentionally pinned.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, TypedDict

import instructor
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

# Judge is pinned to a non-contender model so scores can't be skewed by
# self-preference. gpt-oss-120b is a large reasoning model hosted on Groq,
# ~16x cheaper than gpt-4o on input and ~13x cheaper on output.
GRADER_PROVIDER = "groq"
GRADER_MODEL = "openai/gpt-oss-120b"
GRADER_TEMPERATURE = 0.0

# USD per 1M tokens for the grader itself. Reported separately from extraction
# cost so a model's score isn't conflated with the cost of grading it.
GRADER_PRICING_USD_PER_M: tuple[float, float] = (0.15, 0.75)


class _GraderProviderConfig(TypedDict):
    base_url: str | None
    api_key_env: str
    mode: instructor.Mode


_PROVIDER_CONFIG: dict[str, _GraderProviderConfig] = {
    "openai": {
        "base_url": None,
        "api_key_env": "OPENAI_API_KEY",
        "mode": instructor.Mode.TOOLS,
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        # Groq's tool-calling is flaky for structured output; JSON mode is
        # what extraction.py uses for the same reason.
        "mode": instructor.Mode.JSON,
    },
}


class GraderVerdict(BaseModel):
    score: int = Field(
        ...,
        ge=1,
        le=10,
        description=(
            "Overall extraction quality. 1=unusable, 5=usable but flawed, "
            "8=good, 10=indistinguishable from a careful human."
        ),
    )
    strengths: list[str] = Field(
        default_factory=list,
        description="Concrete things the extraction got right. Each item is one short phrase.",
    )
    weaknesses: list[str] = Field(
        default_factory=list,
        description="Concrete problems with the extraction. Each item is one short phrase.",
    )
    explanation: str = Field(
        ...,
        description="One short paragraph (2–4 sentences) tying strengths and weaknesses to the score.",
    )


@dataclass
class GraderRunDetails:
    model: str
    prompt_tokens: int
    completion_tokens: int
    tokens_used: int
    cost_usd: float


_grader_client: instructor.AsyncInstructor | None = None


def _get_client() -> instructor.AsyncInstructor:
    global _grader_client
    if _grader_client is not None:
        return _grader_client
    cfg = _PROVIDER_CONFIG.get(GRADER_PROVIDER)
    if cfg is None:
        raise RuntimeError(f"Unsupported GRADER_PROVIDER '{GRADER_PROVIDER}'.")
    api_key = os.getenv(cfg["api_key_env"])
    if not api_key:
        raise RuntimeError(
            f"Grader requires {cfg['api_key_env']} "
            f"(uses {GRADER_PROVIDER}/{GRADER_MODEL} as the fixed judge)."
        )
    _grader_client = instructor.from_openai(
        AsyncOpenAI(base_url=cfg["base_url"], api_key=api_key),
        mode=cfg["mode"],
    )
    return _grader_client


SYSTEM_PROMPT = """You are an expert reviewer judging the quality of a structured event extraction.

A separate LLM was given raw parent-facing text (school newsletter, WhatsApp message, etc.) and asked to extract a structured event. You are judging ONLY three fields of that output:
  1. title — short, natural label a parent would recognize at a glance.
  2. description — up to a few sentences (≤240 chars) capturing the essence.
  3. action_items — concrete things a parent must do, phrased the way they'd actually want them.

You will be shown:
- The raw input text.
- The golden expectation (a partial spec — only fields the dataset asserts on).
- The actual extracted event (full structured output).

Ignore all other fields (type, time, location, confidence) — those are handled by rule-based checks and are out of scope here. Do not comment on them.

For each of the three in-scope fields, ask:
- title: is it natural and useful, or robotic, overstuffed, or generic?
- description: does it summarize the event accurately in up to a few sentences (≤240 chars), or is it padded, truncated, or off-topic?
- action_items: are they complete, accurate, and phrased actionably? Anything hallucinated or missed?

Score on a 1–10 scale (based ONLY on those three fields):
- 1–3: unusable; hallucinated, wrong event, or one of the three fields is broken.
- 4–6: usable but clearly flawed; a parent would have to rewrite something.
- 7–8: good; minor phrasing issues only.
- 9–10: indistinguishable from a careful human assistant.

Be specific. "Title is wordy" beats "could be better". Reference the exact field in every strength/weakness.
"""


def _format_user_message(
    raw_text: str,
    expected: dict[str, Any],
    actual_event: dict[str, Any] | None,
    extraction_error: str | None,
) -> str:
    parts = [
        "RAW INPUT:",
        raw_text.strip(),
        "",
        "GOLDEN EXPECTATION (partial — only asserted fields):",
        json.dumps(expected, indent=2, default=str),
        "",
    ]
    if extraction_error:
        parts += [
            "EXTRACTION FAILED with error:",
            extraction_error,
            "",
            "There is no actual event to grade. Score 1 and explain that the extraction errored.",
        ]
    else:
        parts += [
            "ACTUAL EXTRACTION:",
            json.dumps(actual_event, indent=2, default=str),
            "",
            "Judge ONLY title, description, and action_items. Ignore every other field. "
            "Return strengths, weaknesses, a one-paragraph explanation, and a 1–10 score.",
        ]
    return "\n".join(parts)


async def grade_case(
    *,
    raw_text: str,
    expected: dict[str, Any],
    actual_event: dict[str, Any] | None,
    extraction_error: str | None = None,
) -> tuple[GraderVerdict, GraderRunDetails]:
    client = _get_client()
    user_message = _format_user_message(
        raw_text=raw_text,
        expected=expected,
        actual_event=actual_event,
        extraction_error=extraction_error,
    )
    verdict, completion = await client.chat.completions.create_with_completion(
        model=GRADER_MODEL,
        response_model=GraderVerdict,
        temperature=GRADER_TEMPERATURE,
        max_retries=2,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    )
    prompt_tokens = completion.usage.prompt_tokens if completion.usage else 0
    completion_tokens = completion.usage.completion_tokens if completion.usage else 0
    in_per_m, out_per_m = GRADER_PRICING_USD_PER_M
    cost_usd = (prompt_tokens * in_per_m + completion_tokens * out_per_m) / 1_000_000
    details = GraderRunDetails(
        model=f"{GRADER_PROVIDER}/{GRADER_MODEL}",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        tokens_used=prompt_tokens + completion_tokens,
        cost_usd=cost_usd,
    )
    return verdict, details
