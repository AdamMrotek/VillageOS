"""Extraction eval runner.

Sweeps a matrix of (provider, model, prompt_version) over the golden dataset,
captures tokens / latency / per-field correctness, and appends one JSON row per
(case × model × prompt) to evals/extraction/results.jsonl (read by eval-viewer).

Usage:
    # full default matrix
    python -m evals.extraction.run

    # subset for fast iteration
    python -m evals.extraction.run --models openai/gpt-4o-mini

    # compare prompt versions
    python -m evals.extraction.run --prompt-versions v1,v2

The script does NOT run under pytest — it intentionally hits real APIs and
costs real money. Treat each invocation as a deliberate measurement.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import itertools
import json
import os
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from app.prompts.extraction import VERSIONS as PROMPT_VERSIONS
from app.prompts.extraction import VISION_VERSION
from app.services.extraction import ExtractionRunDetails, extract_event
from evals.extraction.grader import (
    GRADER_MODEL,
    GRADER_PROVIDER,
    GraderRunDetails,
    GraderVerdict,
    grade_case,
)
from evals.extraction.storage import append_rows, new_run_id

API_ROOT = Path(__file__).resolve().parents[2]  # .../apps/api
GOLDEN_DIR = API_ROOT / "tests/golden"
JSONL_PATH = API_ROOT / "evals/extraction/results.jsonl"

FROZEN_TODAY = date(2026, 5, 10)
START_TIME_TOLERANCE = timedelta(minutes=30)
TOLERANCE_MIN = int(START_TIME_TOLERANCE.total_seconds() // 60)

# Env var that gates each provider. Combos whose key is unset are skipped.
PROVIDER_ENV = {
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "google": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}

# USD per 1M tokens. Update as provider pricing changes — these drive the cost
# column in the report. Unknown combos fall back to (0, 0) and print "n/a".
PRICING_USD_PER_M: dict[tuple[str, str], tuple[float, float]] = {
    ("openai", "gpt-4o-mini"): (0.15, 0.60),
    ("openai", "gpt-4o"): (2.50, 10.00),
    ("groq", "llama-3.3-70b-versatile"): (0.59, 0.79),
    ("groq", "llama-3.1-8b-instant"): (0.05, 0.08),
    # Groq mid-tier candidates evaluated 2026-05-10. Verify against
    # https://groq.com/pricing before quoting these in production.
    ("groq", "meta-llama/llama-4-scout-17b-16e-instruct"): (0.11, 0.34),
    ("groq", "openai/gpt-oss-20b"): (0.10, 0.50),
    ("groq", "openai/gpt-oss-120b"): (0.15, 0.75),
    ("groq", "qwen/qwen3-32b"): (0.29, 0.59),
    # Scout-replacement survey (2026-07-18). Groq qwen3.6-27b price is an
    # estimate — verify against https://groq.com/pricing before quoting.
    ("groq", "qwen/qwen3.6-27b"): (0.20, 0.60),
    ("openai", "gpt-4.1-mini"): (0.40, 1.60),
    ("openai", "gpt-5-mini"): (0.25, 2.00),
    # Google Gemini vision candidates. Prices verified against
    # https://ai.google.dev/gemini-api/docs/pricing on 2026-07-18.
    # gemini-2.5-flash-lite is the cheapest but shuts down 2026-10-16;
    # gemini-3.1-flash-lite is the GA, durable Scout-class pick.
    ("google", "gemini-2.5-flash-lite"): (0.10, 0.40),
    ("google", "gemini-3.1-flash-lite"): (0.25, 1.50),
    ("google", "gemini-3-flash-preview"): (0.50, 3.00),
    # OpenRouter free tier — $0 tokens (subject to daily/per-minute rate limits).
    ("openrouter", "google/gemma-4-26b-a4b-it:free"): (0.0, 0.0),
}

DEFAULT_MATRIX: list[tuple[str, str]] = [
    ("openai", "gpt-4o-mini"),
    ("openai", "gpt-4o"),
    ("groq", "llama-3.3-70b-versatile"),
    ("groq", "llama-3.1-8b-instant"),
]

# Combos allowed to receive image cases; everything else skips them (a text
# model erroring on an image row is noise, not signal).
VISION_CAPABLE: set[tuple[str, str]] = {
    ("openai", "gpt-4o"),
    ("openai", "gpt-4o-mini"),
    # Llama-4 Scout is natively multimodal; Groq accepts OpenAI-style
    # image_url content parts under JSON mode (their docs, 2026-06).
    ("groq", "meta-llama/llama-4-scout-17b-16e-instruct"),
    # Scout-replacement candidates (2026-07-18). qwen3.6-27b is now the only
    # vision model on Groq; gpt-4.1-mini / gpt-5-mini replace the gpt-4o pin.
    ("groq", "qwen/qwen3.6-27b"),
    ("openai", "gpt-4.1-mini"),
    ("openai", "gpt-5-mini"),
    # Google Gemini flash tier — Scout-class cheap/fast vision candidates (2026-07-18).
    ("google", "gemini-2.5-flash-lite"),
    ("google", "gemini-3.1-flash-lite"),
    ("google", "gemini-3-flash-preview"),
    # OpenRouter free vision model — zero-cost Scout-replacement trial (2026-07-18).
    ("openrouter", "google/gemma-4-26b-a4b-it:free"),
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------
@dataclass
class GoldenCase:
    case_id: str
    raw_text: str | None
    expected: dict
    image_path: Path | None = None

    @property
    def grader_text(self) -> str:
        """What the text-only LLM judge reads as 'the input'. Image cases carry
        a faithful transcript in expected["transcript"] for this purpose."""
        return (
            self.raw_text or self.expected.get("transcript") or f"[image-only case {self.case_id}]"
        )


@dataclass
class FieldCheck:
    name: str
    expected: Any
    actual: Any
    passed: bool


@dataclass
class CaseResult:
    case_id: str
    provider: str
    model: str
    prompt_version: str
    duration_s: float
    details: ExtractionRunDetails | None
    event_dump: dict | None
    error: str | None
    checks: list[FieldCheck] = field(default_factory=list)
    grader: GraderVerdict | None = None
    grader_details: GraderRunDetails | None = None
    grader_error: str | None = None

    @property
    def all_passed(self) -> bool:
        return self.error is None and all(c.passed for c in self.checks)

    @property
    def tokens(self) -> int:
        return self.details.tokens_used if self.details else 0

    @property
    def status_mark(self) -> str:
        """Console glyph: ⚠ on error, ✓ if every check passed, else ✗."""
        return "⚠" if self.error else ("✓" if self.all_passed else "✗")


def load_cases() -> list[GoldenCase]:
    cases: list[GoldenCase] = []
    for path in sorted(GOLDEN_DIR.iterdir()):
        if path.suffix == ".txt":
            cases.append(
                GoldenCase(
                    case_id=path.stem,
                    raw_text=path.read_text(),
                    expected=json.loads(path.with_suffix(".json").read_text()),
                )
            )
        elif path.suffix.lower() in IMAGE_EXTS:
            cases.append(
                GoldenCase(
                    case_id=path.stem,
                    raw_text=None,
                    expected=json.loads(path.with_suffix(".json").read_text()),
                    image_path=path,
                )
            )
    return cases


# Mirror the client-side uploader (apps/web/src/lib/image-downscale.ts) so image
# cases send the same payload production does: long edge capped at 1568px,
# re-encoded to JPEG q0.8, transparency flattened onto white. Feeding raw golden
# files instead inflates tokens/cost/latency and can trip rate limits production
# would never hit.
IMAGE_MAX_LONG_EDGE = 1568
IMAGE_JPEG_QUALITY = 80


def image_to_data_url(path: Path) -> str:
    from PIL import Image

    im = Image.open(path)
    scale = min(1.0, IMAGE_MAX_LONG_EDGE / max(im.width, im.height))
    if scale < 1.0:
        im = im.resize(
            (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
            Image.LANCZOS,
        )
    # JPEG has no alpha: flatten transparency onto white, matching the canvas fill.
    if im.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", im.size, (255, 255, 255))
        rgba = im.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        im = background
    else:
        im = im.convert("RGB")

    buffer = io.BytesIO()
    im.save(buffer, "JPEG", quality=IMAGE_JPEG_QUALITY)
    encoded = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/jpeg;base64,{encoded}"


# ---------------------------------------------------------------------------
# Rule-based grading
# ---------------------------------------------------------------------------
def _check(name: str, expected: Any, actual: Any, passed: bool) -> FieldCheck:
    return FieldCheck(name=name, expected=expected, actual=actual, passed=passed)


def _date_check(name: str, expected_iso: str, actual: date | None) -> FieldCheck:
    expected = date.fromisoformat(expected_iso)
    return _check(
        name,
        expected.isoformat(),
        actual.isoformat() if actual else "<none>",
        actual == expected,
    )


def _time_check(name: str, expected_iso: str, actual: datetime | None) -> FieldCheck:
    expected = datetime.fromisoformat(expected_iso)
    delta = abs(actual - expected) if actual else None
    return _check(
        name,
        f"{expected.isoformat()} (±{TOLERANCE_MIN}m)",
        actual.isoformat() if actual else "<none>",
        delta is not None and delta <= START_TIME_TOLERANCE,
    )


def _keyword_check(keywords: list, action_items: Any) -> FieldCheck:
    joined = " | ".join(item.description for item in action_items).lower()

    def matches(spec: Any) -> bool:
        # A list spec is an OR-group: any one substring satisfies it.
        if isinstance(spec, list):
            return any(alt.lower() in joined for alt in spec)
        return spec.lower() in joined

    def fmt(spec: Any) -> str:
        if isinstance(spec, list):
            return "(" + "|".join(spec) + ")"
        return repr(spec)

    missing = [spec for spec in keywords if not matches(spec)]
    return _check(
        "action_items_keywords",
        "all of: " + ", ".join(fmt(s) for s in keywords),
        f"got: {joined or '<none>'}"
        + (f" — missing: {[fmt(s) for s in missing]}" if missing else ""),
        not missing,
    )


def evaluate_case(case: GoldenCase, event: Any) -> list[FieldCheck]:
    expected = case.expected
    checks: list[FieldCheck] = []

    title = (event.title or "").strip()
    checks.append(
        _check(
            "title_nonempty",
            "non-empty, not raw input",
            title or "<empty>",
            bool(title) and title != (case.raw_text or "").strip(),
        )
    )

    accepted_types = expected["event_type"]
    if isinstance(accepted_types, str):
        accepted_types = [accepted_types]
    actual_type = event.event_type.value
    checks.append(_check("event_type", accepted_types, actual_type, actual_type in accepted_types))

    checks.append(
        _check("confidence>=0.7", ">= 0.7", round(event.confidence, 2), event.confidence >= 0.7)
    )
    checks.append(
        _check(
            "is_all_day",
            expected["is_all_day"],
            event.is_all_day,
            event.is_all_day == expected["is_all_day"],
        )
    )

    if expected["is_all_day"]:
        checks.append(_date_check("start_date", expected["start_date"], event.start_time.date()))
        if "end_date" in expected:
            actual_end = event.end_time.date() if event.end_time else None
            checks.append(_date_check("end_date", expected["end_date"], actual_end))
    else:
        checks.append(
            _time_check("start_time", expected["start_time"], event.start_time.replace(tzinfo=None))
        )
        if "end_time" in expected:
            actual_end = event.end_time.replace(tzinfo=None) if event.end_time else None
            checks.append(_time_check("end_time", expected["end_time"], actual_end))

    if "action_items_keywords" in expected:
        checks.append(_keyword_check(expected["action_items_keywords"], event.action_items))

    return checks


# ---------------------------------------------------------------------------
# Running a single case
# ---------------------------------------------------------------------------
async def run_case(
    case: GoldenCase,
    provider: str,
    model: str,
    prompt_version: str,
    mode: str | None,
) -> CaseResult:
    started = time.perf_counter()
    # Image cases run the vision variant of the requested prompt, mirroring how
    # production defaults image requests to VISION_VERSION. An explicitly
    # non-default --prompt-versions sweep is honored as given.
    if case.image_path is not None and prompt_version == "v3":
        prompt_version = VISION_VERSION
    try:
        response, details = await extract_event(
            case.raw_text,
            today=FROZEN_TODAY,
            image_data_url=image_to_data_url(case.image_path) if case.image_path else None,
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            mode=mode,
            return_details=True,
        )
        return CaseResult(
            case_id=case.case_id,
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            duration_s=time.perf_counter() - started,
            details=details,
            event_dump=response.event.model_dump(mode="json"),
            error=None,
            checks=evaluate_case(case, response.event),
        )
    except Exception as exc:
        return CaseResult(
            case_id=case.case_id,
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            duration_s=time.perf_counter() - started,
            details=None,
            event_dump=None,
            error=f"{type(exc).__name__}: {exc}",
        )


# ---------------------------------------------------------------------------
# Cost + small numeric helpers
# ---------------------------------------------------------------------------
def cost_usd(provider: str, model: str, details: ExtractionRunDetails | None) -> float | None:
    if details is None:
        return None
    price = PRICING_USD_PER_M.get((provider, model))
    if price is None:
        return None
    in_per_m, out_per_m = price
    return (details.prompt_tokens * in_per_m + details.completion_tokens * out_per_m) / 1_000_000


# ---------------------------------------------------------------------------
# Grading (LLM-as-judge)
# ---------------------------------------------------------------------------
async def grade_results(
    results: list[CaseResult],
    cases_by_id: dict[str, GoldenCase],
) -> None:
    """Mutate results in place, attaching grader verdicts.

    Runs sequentially to keep grader rate-limiting predictable and the cost
    column truthful (each grade is one independent call).
    """
    for r in results:
        try:
            verdict, details = await grade_case(
                raw_text=cases_by_id[r.case_id].grader_text,
                expected=cases_by_id[r.case_id].expected,
                actual_event=r.event_dump,
                extraction_error=r.error,
            )
            r.grader = verdict
            r.grader_details = details
            print(
                f"     [grader] {r.status_mark} {r.provider}/{r.model} · {r.case_id}: "
                f"score {verdict.score}/10"
            )
        except Exception as exc:
            r.grader_error = f"{type(exc).__name__}: {exc}"
            print(
                f"     [grader] ⚠ {r.provider}/{r.model} · {r.case_id}: failed — {r.grader_error}"
            )


# ---------------------------------------------------------------------------
# Serialization to JSONL
# ---------------------------------------------------------------------------
def _json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)


def _checks_to_dicts(checks: list[FieldCheck]) -> list[dict]:
    return [
        {
            "name": c.name,
            "expected": _json_safe(c.expected),
            "actual": _json_safe(c.actual),
            "passed": c.passed,
        }
        for c in checks
    ]


def _grader_to_dict(r: CaseResult) -> dict | None:
    if r.grader is None:
        return None
    details = r.grader_details
    return {
        "model": details.model if details else f"{GRADER_PROVIDER}/{GRADER_MODEL}",
        "score": r.grader.score,
        "strengths": list(r.grader.strengths),
        "weaknesses": list(r.grader.weaknesses),
        "explanation": r.grader.explanation,
        "tokens_used": details.tokens_used if details else None,
        "cost_usd": details.cost_usd if details else None,
    }


def result_to_row(r: CaseResult, run_id: str, expected: dict) -> dict:
    rule_checks = _checks_to_dicts(r.checks)
    d = r.details
    return {
        "run_id": run_id,
        "case_id": r.case_id,
        "provider": r.provider,
        "model": r.model,
        "prompt_version": r.prompt_version,
        "frozen_today": FROZEN_TODAY.isoformat(),
        "expected": expected,
        "actual_event": r.event_dump,
        "rule_checks": rule_checks,
        "rule_pass_count": sum(1 for c in rule_checks if c["passed"]),
        "rule_total": len(rule_checks),
        "rule_all_passed": r.all_passed,
        "latency_s": round(r.duration_s, 3),
        # llm_duration_ms is the same instrument production logs (LLM call only),
        # so it's comparable to online; input_length_chars lets the readout
        # normalise tokens per 1k chars. Both feed the offline↔online cost/latency
        # comparison in the experiment write-up. latency_s stays as the
        # end-to-end wall-clock for reference.
        "llm_duration_ms": d.llm_duration_ms if d else None,
        "input_length_chars": d.input_length_chars if d else None,
        "input_type": d.input_type if d else None,
        "image_bytes": d.image_bytes if d else None,
        "tokens_used": d.tokens_used if d else None,
        "prompt_tokens": d.prompt_tokens if d else None,
        "completion_tokens": d.completion_tokens if d else None,
        "instructor_mode": d.mode if d else None,
        "extraction_cost_usd": cost_usd(r.provider, r.model, r.details),
        "error": r.error,
        "grader": _grader_to_dict(r),
        "grader_error": r.grader_error,
    }


# ---------------------------------------------------------------------------
# CLI plumbing
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the extraction eval matrix.")
    parser.add_argument(
        "--models",
        default=None,
        help="Comma-separated provider/model list. Default: all four (openai/gpt-4o-mini, openai/gpt-4o, groq/llama-3.3-70b-versatile, groq/llama-3.1-8b-instant).",
    )
    parser.add_argument(
        "--prompt-versions",
        default=None,
        help=f"Comma-separated prompt versions. Default: current. Available: {','.join(sorted(PROMPT_VERSIONS))}.",
    )
    parser.add_argument(
        "--cases",
        default=None,
        help="Comma-separated case_ids (matches the *.txt or image file stem). Default: all golden cases.",
    )
    parser.add_argument(
        "--mode",
        default=None,
        help="Instructor mode (TOOLS, JSON, JSON_SCHEMA, MD_JSON). Default: TOOLS.",
    )
    parser.add_argument(
        "--no-append",
        action="store_true",
        help="Run the eval but do not append rows to results.jsonl.",
    )
    parser.add_argument(
        "--skip-grader",
        action="store_true",
        help="Skip the LLM-as-judge grader step (faster iteration; cheaper).",
    )
    return parser


def parse_matrix(arg: str | None) -> list[tuple[str, str]]:
    if not arg:
        return list(DEFAULT_MATRIX)
    matrix: list[tuple[str, str]] = []
    for spec in (s.strip() for s in arg.split(",")):
        if not spec:
            continue
        if "/" not in spec:
            raise SystemExit(f"--models entry must be 'provider/model', got '{spec}'")
        provider, model = spec.split("/", 1)
        matrix.append((provider, model))
    return matrix


def resolve_prompt_versions(arg: str | None) -> list[str]:
    if not arg:
        from app.prompts.extraction import CURRENT_VERSION

        return [CURRENT_VERSION]
    versions = [v.strip() for v in arg.split(",") if v.strip()]
    for v in versions:
        if v not in PROMPT_VERSIONS:
            raise SystemExit(f"Unknown prompt version '{v}'. Known: {sorted(PROMPT_VERSIONS)}")
    return versions


def select_cases(arg: str | None) -> list[GoldenCase]:
    cases = load_cases()
    if arg:
        wanted = {c.strip() for c in arg.split(",") if c.strip()}
        cases = [c for c in cases if c.case_id in wanted]
        if not cases:
            raise SystemExit("No matching golden cases for --cases filter.")
    if not cases:
        raise SystemExit(f"No golden cases found in {GOLDEN_DIR}.")
    return cases


def partition_runnable(
    matrix: list[tuple[str, str]],
) -> tuple[list[tuple[str, str]], list[tuple[str, str, str]]]:
    """Split the matrix into runnable combos and those missing an API key."""
    runnable: list[tuple[str, str]] = []
    skipped: list[tuple[str, str, str]] = []
    for provider, model in matrix:
        env = PROVIDER_ENV.get(provider)
        if env and not os.getenv(env):
            skipped.append((provider, model, env))
        else:
            runnable.append((provider, model))
    return runnable, skipped


async def run_matrix(
    cases: list[GoldenCase],
    runnable: list[tuple[str, str]],
    prompt_versions: list[str],
    mode: str | None,
) -> list[CaseResult]:
    results: list[CaseResult] = []
    for version, (provider, model) in itertools.product(prompt_versions, runnable):
        print(f"  -> {provider}/{model} (prompt {version})")
        combo_cases = cases
        if (provider, model) not in VISION_CAPABLE:
            combo_cases = [c for c in cases if c.image_path is None]
            for c in cases:
                if c.image_path is not None:
                    print(
                        f"     [skip] {c.case_id} — image case, {provider}/{model} is not vision-capable"
                    )
        tasks = [run_case(c, provider, model, version, mode) for c in combo_cases]
        for r in await asyncio.gather(*tasks):
            suffix = f" — {r.error}" if r.error else ""
            print(f"     {r.status_mark} {r.case_id}: {r.tokens} tok, {r.duration_s:.2f}s{suffix}")
            results.append(r)
    return results


async def main() -> int:
    args = build_parser().parse_args()

    matrix = parse_matrix(args.models)
    prompt_versions = resolve_prompt_versions(args.prompt_versions)
    cases = select_cases(args.cases)

    # Skip combos for which no API key is configured, so the eval still runs
    # for whatever providers the user has set up.
    runnable, skipped = partition_runnable(matrix)
    for provider, model, env in skipped:
        print(f"[skip] {provider}/{model} — {env} not set")
    if not runnable:
        raise SystemExit("No runnable provider/model combos — set at least one API key.")

    # Image cases only run on vision-capable combos, so count per combo.
    n_text = sum(1 for c in cases if c.image_path is None)
    total_calls = len(prompt_versions) * sum(
        len(cases) if combo in VISION_CAPABLE else n_text for combo in runnable
    )
    print(
        f"Running {len(cases)} case(s) × {len(runnable)} model(s) × "
        f"{len(prompt_versions)} prompt version(s) = {total_calls} call(s)..."
    )

    run_id = new_run_id()
    print(f"Run ID: {run_id}")

    results = await run_matrix(cases, runnable, prompt_versions, args.mode)

    grader_enabled = not args.skip_grader
    if grader_enabled:
        cases_by_id = {c.case_id: c for c in cases}
        print(f"\nGrading {len(results)} result(s) with {GRADER_PROVIDER}/{GRADER_MODEL}...")
        await grade_results(results, cases_by_id)

    passed = sum(1 for r in results if r.all_passed)
    print(f"\n{passed}/{len(results)} result(s) passed all rule checks.")

    if not args.no_append:
        JSONL_PATH.parent.mkdir(parents=True, exist_ok=True)
        expected_by_id = {c.case_id: c.expected for c in cases}
        rows = [result_to_row(r, run_id, expected_by_id[r.case_id]) for r in results]
        written = append_rows(JSONL_PATH, rows)
        print(f"Appended {written} row(s) to {JSONL_PATH.relative_to(API_ROOT)}")

    return 1 if any(not r.all_passed for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
