"""Extraction eval runner.

Sweeps a matrix of (provider, model, prompt_version) over the golden dataset,
captures tokens / latency / per-field correctness, and appends a markdown report
to evals/extraction/results.md.

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
from app.services.extraction import ExtractionRunDetails, extract_event

API_ROOT = Path(__file__).resolve().parents[2]  # .../apps/api
GOLDEN_DIR = API_ROOT / "tests/golden"
RESULTS_PATH = API_ROOT / "evals/extraction/results.md"

FROZEN_TODAY = date(2026, 5, 10)
START_TIME_TOLERANCE = timedelta(minutes=30)

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
}

DEFAULT_MATRIX: list[tuple[str, str]] = [
    ("openai", "gpt-4o-mini"),
    ("openai", "gpt-4o"),
    ("groq", "llama-3.3-70b-versatile"),
    ("groq", "llama-3.1-8b-instant"),
]


@dataclass
class GoldenCase:
    case_id: str
    raw_text: str
    expected: dict


def load_cases() -> list[GoldenCase]:
    cases: list[GoldenCase] = []
    for txt_path in sorted(GOLDEN_DIR.glob("*.txt")):
        json_path = txt_path.with_suffix(".json")
        cases.append(
            GoldenCase(
                case_id=txt_path.stem,
                raw_text=txt_path.read_text(),
                expected=json.loads(json_path.read_text()),
            )
        )
    return cases


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

    @property
    def all_passed(self) -> bool:
        return self.error is None and all(c.passed for c in self.checks)


def _check(name: str, expected: Any, actual: Any, passed: bool) -> FieldCheck:
    return FieldCheck(name=name, expected=expected, actual=actual, passed=passed)


def evaluate_case(case: GoldenCase, event: Any) -> list[FieldCheck]:
    checks: list[FieldCheck] = []
    expected = case.expected

    title = (event.title or "").strip()
    checks.append(
        _check(
            "title_nonempty",
            "non-empty, not raw input",
            title or "<empty>",
            bool(title) and title != case.raw_text.strip(),
        )
    )

    accepted_types = expected["event_type"]
    if isinstance(accepted_types, str):
        accepted_types = [accepted_types]
    actual_type = event.event_type.value
    checks.append(
        _check(
            "event_type",
            accepted_types,
            actual_type,
            actual_type in accepted_types,
        )
    )

    checks.append(
        _check(
            "confidence>=0.7",
            ">= 0.7",
            round(event.confidence, 2),
            event.confidence >= 0.7,
        )
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
        expected_date = date.fromisoformat(expected["start_date"])
        actual_date = event.start_time.date()
        checks.append(
            _check(
                "start_date",
                expected_date.isoformat(),
                actual_date.isoformat(),
                actual_date == expected_date,
            )
        )
    else:
        expected_start = datetime.fromisoformat(expected["start_time"])
        actual_start = event.start_time.replace(tzinfo=None)
        delta = abs(actual_start - expected_start)
        checks.append(
            _check(
                "start_time",
                f"{expected_start.isoformat()} (±{int(START_TIME_TOLERANCE.total_seconds() // 60)}m)",
                actual_start.isoformat(),
                delta <= START_TIME_TOLERANCE,
            )
        )

    if "action_items_keywords" in expected:
        joined = " | ".join(item.description for item in event.action_items).lower()
        keywords = expected["action_items_keywords"]
        missing = [kw for kw in keywords if kw.lower() not in joined]
        checks.append(
            _check(
                "action_items_keywords",
                f"all of: {keywords}",
                f"got: {joined or '<none>'}"
                + (f" — missing: {missing}" if missing else ""),
                not missing,
            )
        )

    return checks


async def run_case(
    case: GoldenCase,
    provider: str,
    model: str,
    prompt_version: str,
    mode: str,
) -> CaseResult:
    started = time.perf_counter()
    try:
        response, details = await extract_event(
            case.raw_text,
            today=FROZEN_TODAY,
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            mode=mode,
            return_details=True,
        )
        duration = time.perf_counter() - started
        checks = evaluate_case(case, response.event)
        return CaseResult(
            case_id=case.case_id,
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            duration_s=duration,
            details=details,
            event_dump=response.event.model_dump(mode="json"),
            error=None,
            checks=checks,
        )
    except Exception as exc:
        duration = time.perf_counter() - started
        return CaseResult(
            case_id=case.case_id,
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            duration_s=duration,
            details=None,
            event_dump=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def cost_usd(provider: str, model: str, details: ExtractionRunDetails | None) -> float | None:
    if details is None:
        return None
    price = PRICING_USD_PER_M.get((provider, model))
    if price is None:
        return None
    in_per_m, out_per_m = price
    return (
        details.prompt_tokens * in_per_m + details.completion_tokens * out_per_m
    ) / 1_000_000


def fmt_cost(value: float | None) -> str:
    if value is None:
        return "n/a"
    # Per-call costs are tiny; show per-1k-calls so the number is readable.
    return f"${value * 1000:.4f}/1k"


def render_report(
    results: list[CaseResult],
    matrix: list[tuple[str, str]],
    prompt_versions: list[str],
    case_ids: list[str],
    notes: str | None,
) -> str:
    lines: list[str] = []
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append(f"## Run: {timestamp}\n")
    lines.append(
        "**Pipeline:** instructor + structured ParentEvent extraction (Mode.TOOLS)  "
    )
    lines.append(f"**Prompt versions:** {', '.join(prompt_versions)}  ")
    lines.append(
        f"**Models:** {', '.join(f'{p}/{m}' for p, m in matrix)}  "
    )
    lines.append(f"**Cases:** {', '.join(case_ids)}  ")
    modes_used = sorted({r.details.mode for r in results if r.details})
    if modes_used:
        lines.append(f"**Instructor mode:** {', '.join(modes_used)}  ")
    lines.append(f"**Frozen today:** {FROZEN_TODAY.isoformat()}\n")
    if notes:
        lines.append(f"> {notes}\n")

    # ---- Summary table -----------------------------------------------------
    lines.append("### Summary\n")
    lines.append(
        "| Provider/Model | Prompt | Cases passed | Avg tokens | Avg latency | Avg cost |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- |")

    for version in prompt_versions:
        for provider, model in matrix:
            subset = [
                r for r in results
                if r.provider == provider and r.model == model and r.prompt_version == version
            ]
            if not subset:
                continue
            passed = sum(1 for r in subset if r.all_passed)
            ok = [r for r in subset if r.details is not None]
            avg_tokens = (
                int(sum(r.details.tokens_used for r in ok) / len(ok)) if ok else 0
            )
            avg_latency = (
                sum(r.duration_s for r in ok) / len(ok) if ok else 0.0
            )
            costs = [cost_usd(provider, model, r.details) for r in ok]
            real_costs = [c for c in costs if c is not None]
            avg_cost = sum(real_costs) / len(real_costs) if real_costs else None

            lines.append(
                f"| {provider}/{model} | {version} | {passed}/{len(subset)} | "
                f"{avg_tokens} | {avg_latency:.2f}s | {fmt_cost(avg_cost)} |"
            )

    lines.append("")

    # ---- Per-case detail ---------------------------------------------------
    for case_id in case_ids:
        lines.append(f"### {case_id}\n")
        for version in prompt_versions:
            for provider, model in matrix:
                r = next(
                    (
                        x for x in results
                        if x.case_id == case_id and x.provider == provider
                        and x.model == model and x.prompt_version == version
                    ),
                    None,
                )
                if r is None:
                    continue
                tag = f"{provider}/{model} · prompt {version}"
                if r.error:
                    lines.append(f"**{tag}** — ❌ error: `{r.error}`\n")
                    continue

                tokens = r.details.tokens_used if r.details else 0
                cost = cost_usd(provider, model, r.details)
                status = "✓" if r.all_passed else "✗"
                lines.append(
                    f"**{tag}** — {status} · "
                    f"{tokens} tokens · {r.duration_s:.2f}s · {fmt_cost(cost)}"
                )
                lines.append("")
                lines.append("| field | expected | actual | ✓ |")
                lines.append("| --- | --- | --- | --- |")
                for c in r.checks:
                    mark = "✓" if c.passed else "✗"
                    lines.append(
                        f"| {c.name} | {c.expected} | {c.actual} | {mark} |"
                    )
                lines.append("")

    lines.append("---\n")
    return "\n".join(lines)


async def main() -> int:
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
        help="Comma-separated case_ids (matches *.txt stem). Default: all golden cases.",
    )
    parser.add_argument(
        "--mode",
        default=None,
        help="Instructor mode (TOOLS, JSON, JSON_SCHEMA, MD_JSON). Default: TOOLS.",
    )
    parser.add_argument(
        "--notes",
        default=None,
        help="Free-text note to embed in this run's header.",
    )
    parser.add_argument(
        "--no-append",
        action="store_true",
        help="Print the report but do not append to results.md.",
    )
    args = parser.parse_args()

    if args.models:
        matrix = []
        for spec in args.models.split(","):
            spec = spec.strip()
            if not spec:
                continue
            if "/" not in spec:
                raise SystemExit(f"--models entry must be 'provider/model', got '{spec}'")
            provider, model = spec.split("/", 1)
            matrix.append((provider, model))
    else:
        matrix = list(DEFAULT_MATRIX)

    if args.prompt_versions:
        prompt_versions = [v.strip() for v in args.prompt_versions.split(",") if v.strip()]
        for v in prompt_versions:
            if v not in PROMPT_VERSIONS:
                raise SystemExit(f"Unknown prompt version '{v}'. Known: {sorted(PROMPT_VERSIONS)}")
    else:
        from app.prompts.extraction import CURRENT_VERSION
        prompt_versions = [CURRENT_VERSION]

    cases = load_cases()
    if args.cases:
        wanted = {c.strip() for c in args.cases.split(",") if c.strip()}
        cases = [c for c in cases if c.case_id in wanted]
        if not cases:
            raise SystemExit("No matching golden cases for --cases filter.")

    if not cases:
        raise SystemExit(f"No golden cases found in {GOLDEN_DIR}.")

    # Skip combos for which no API key is configured, so the eval still runs
    # for whatever providers the user has set up.
    skipped: list[tuple[str, str, str]] = []
    runnable: list[tuple[str, str]] = []
    for provider, model in matrix:
        env = {"openai": "OPENAI_API_KEY", "groq": "GROQ_API_KEY"}.get(provider)
        if env and not os.getenv(env):
            skipped.append((provider, model, env))
        else:
            runnable.append((provider, model))

    if skipped:
        for provider, model, env in skipped:
            print(f"[skip] {provider}/{model} — {env} not set")
    if not runnable:
        raise SystemExit("No runnable provider/model combos — set at least one API key.")

    print(
        f"Running {len(cases)} case(s) × {len(runnable)} model(s) × "
        f"{len(prompt_versions)} prompt version(s) = "
        f"{len(cases) * len(runnable) * len(prompt_versions)} call(s)..."
    )

    results: list[CaseResult] = []
    for version in prompt_versions:
        for provider, model in runnable:
            print(f"  -> {provider}/{model} (prompt {version})")
            tasks = [run_case(c, provider, model, version, args.mode) for c in cases]
            for r in await asyncio.gather(*tasks):
                mark = "✓" if r.all_passed else ("⚠" if r.error else "✗")
                tokens = r.details.tokens_used if r.details else 0
                print(
                    f"     {mark} {r.case_id}: {tokens} tok, {r.duration_s:.2f}s"
                    + (f" — {r.error}" if r.error else "")
                )
                results.append(r)

    report = render_report(
        results=results,
        matrix=runnable,
        prompt_versions=prompt_versions,
        case_ids=[c.case_id for c in cases],
        notes=args.notes,
    )

    print()
    print(report)

    if not args.no_append:
        RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not RESULTS_PATH.exists():
            RESULTS_PATH.write_text("# VillageOS — Extraction Eval Results\n\n---\n\n")
        with RESULTS_PATH.open("a") as f:
            f.write(report)
            f.write("\n")
        print(f"Appended to {RESULTS_PATH.relative_to(API_ROOT)}")

    any_failures = any(not r.all_passed for r in results)
    return 1 if any_failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
