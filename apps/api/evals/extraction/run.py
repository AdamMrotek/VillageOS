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
    grader: GraderVerdict | None = None
    grader_details: GraderRunDetails | None = None
    grader_error: str | None = None

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
        if "end_date" in expected:
            expected_end_date = date.fromisoformat(expected["end_date"])
            actual_end_date = event.end_time.date() if event.end_time else None
            checks.append(
                _check(
                    "end_date",
                    expected_end_date.isoformat(),
                    actual_end_date.isoformat() if actual_end_date else "<none>",
                    actual_end_date == expected_end_date,
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
        if "end_time" in expected:
            expected_end = datetime.fromisoformat(expected["end_time"])
            actual_end = event.end_time.replace(tzinfo=None) if event.end_time else None
            end_delta = abs(actual_end - expected_end) if actual_end else None
            checks.append(
                _check(
                    "end_time",
                    f"{expected_end.isoformat()} (±{int(START_TIME_TOLERANCE.total_seconds() // 60)}m)",
                    actual_end.isoformat() if actual_end else "<none>",
                    end_delta is not None and end_delta <= START_TIME_TOLERANCE,
                )
            )

    if "action_items_keywords" in expected:
        joined = " | ".join(item.description for item in event.action_items).lower()
        keywords = expected["action_items_keywords"]

        def _matches(spec: Any) -> bool:
            # A list spec is an OR-group: any one substring satisfies it.
            if isinstance(spec, list):
                return any(alt.lower() in joined for alt in spec)
            return spec.lower() in joined

        def _fmt(spec: Any) -> str:
            if isinstance(spec, list):
                return "(" + "|".join(spec) + ")"
            return repr(spec)

        missing = [spec for spec in keywords if not _matches(spec)]
        checks.append(
            _check(
                "action_items_keywords",
                "all of: " + ", ".join(_fmt(s) for s in keywords),
                f"got: {joined or '<none>'}"
                + (f" — missing: {[_fmt(s) for s in missing]}" if missing else ""),
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


def _checks_to_dicts(checks: list[FieldCheck]) -> list[dict]:
    return [
        {
            "name": c.name,
            "expected": c.expected if isinstance(c.expected, (str, int, float, bool, list, dict)) else str(c.expected),
            "actual": c.actual if isinstance(c.actual, (str, int, float, bool, list, dict)) else str(c.actual),
            "passed": c.passed,
        }
        for c in checks
    ]


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
                raw_text=cases_by_id[r.case_id].raw_text,
                expected=cases_by_id[r.case_id].expected,
                actual_event=r.event_dump,
                extraction_error=r.error,
            )
            r.grader = verdict
            r.grader_details = details
            mark = "⚠" if r.error else ("✓" if r.all_passed else "✗")
            print(
                f"     [grader] {mark} {r.provider}/{r.model} · {r.case_id}: "
                f"score {verdict.score}/10"
            )
        except Exception as exc:
            r.grader_error = f"{type(exc).__name__}: {exc}"
            print(
                f"     [grader] ⚠ {r.provider}/{r.model} · {r.case_id}: failed — {r.grader_error}"
            )


def result_to_row(r: CaseResult, run_id: str, expected: dict) -> dict:
    rule_checks = _checks_to_dicts(r.checks)
    rule_pass = sum(1 for c in rule_checks if c["passed"])
    extraction_cost = cost_usd(r.provider, r.model, r.details)
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
        "rule_pass_count": rule_pass,
        "rule_total": len(rule_checks),
        "rule_all_passed": r.all_passed,
        "latency_s": round(r.duration_s, 3),
        "tokens_used": r.details.tokens_used if r.details else None,
        "prompt_tokens": r.details.prompt_tokens if r.details else None,
        "completion_tokens": r.details.completion_tokens if r.details else None,
        "instructor_mode": r.details.mode if r.details else None,
        "extraction_cost_usd": extraction_cost,
        "error": r.error,
        "grader": (
            {
                "model": r.grader_details.model if r.grader_details else f"{GRADER_PROVIDER}/{GRADER_MODEL}",
                "score": r.grader.score,
                "strengths": list(r.grader.strengths),
                "weaknesses": list(r.grader.weaknesses),
                "explanation": r.grader.explanation,
                "tokens_used": r.grader_details.tokens_used if r.grader_details else None,
                "cost_usd": r.grader_details.cost_usd if r.grader_details else None,
            }
            if r.grader is not None
            else None
        ),
        "grader_error": r.grader_error,
    }


def render_report(
    results: list[CaseResult],
    matrix: list[tuple[str, str]],
    prompt_versions: list[str],
    case_ids: list[str],
    notes: str | None,
    run_id: str,
    grader_enabled: bool,
) -> str:
    lines: list[str] = []
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append(f"## Run: {timestamp}  ·  `{run_id}`\n")
    lines.append(
        "**Pipeline:** instructor + structured ParentEvent extraction  "
    )
    lines.append(f"**Prompt versions:** {', '.join(prompt_versions)}  ")
    lines.append(
        f"**Contender models:** {', '.join(f'{p}/{m}' for p, m in matrix)}  "
    )
    lines.append(f"**Cases:** {', '.join(case_ids)}  ")
    modes_used = sorted({r.details.mode for r in results if r.details})
    if modes_used:
        lines.append(f"**Instructor mode:** {', '.join(modes_used)}  ")
    lines.append(f"**Frozen today:** {FROZEN_TODAY.isoformat()}  ")
    if grader_enabled:
        lines.append(f"**Grader (judge):** {GRADER_PROVIDER}/{GRADER_MODEL}  ")
    else:
        lines.append("**Grader (judge):** _disabled (--skip-grader)_  ")
    lines.append("")
    if notes:
        lines.append(f"> {notes}\n")

    # ---- Per prompt-version: contender table + per-case detail -----------
    for version in prompt_versions:
        lines.append(f"## Prompt `{version}`\n")
        lines.append("### Contenders\n")
        header = "| Provider/Model | Rule pass | Grader avg | Avg tokens | Avg latency | Extraction $/1k | Grader $/1k |"
        sep =    "| --- | --- | --- | --- | --- | --- | --- |"
        lines.append(header)
        lines.append(sep)

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
            extraction_costs = [cost_usd(provider, model, r.details) for r in ok]
            real_extraction_costs = [c for c in extraction_costs if c is not None]
            avg_extraction_cost = (
                sum(real_extraction_costs) / len(real_extraction_costs)
                if real_extraction_costs else None
            )
            graded = [r for r in subset if r.grader is not None]
            grader_avg = (
                sum(r.grader.score for r in graded) / len(graded)
                if graded else None
            )
            grader_costs = [r.grader_details.cost_usd for r in subset if r.grader_details]
            avg_grader_cost = (
                sum(grader_costs) / len(grader_costs) if grader_costs else None
            )
            grader_cell = f"{grader_avg:.1f}/10" if grader_avg is not None else "—"
            lines.append(
                f"| {provider}/{model} | {passed}/{len(subset)} | {grader_cell} | "
                f"{avg_tokens} | {avg_latency:.2f}s | {fmt_cost(avg_extraction_cost)} | "
                f"{fmt_cost(avg_grader_cost)} |"
            )

        lines.append("")

        # ---- Per-case detail ---------------------------------------------
        for case_id in case_ids:
            lines.append(f"### {case_id}\n")
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
                tag = f"{provider}/{model}"
                if r.error:
                    lines.append(f"**{tag}** — ❌ error: `{r.error}`\n")
                    if r.grader is not None:
                        lines.append(
                            f"> Grader: **{r.grader.score}/10** — {r.grader.explanation}\n"
                        )
                    continue

                tokens = r.details.tokens_used if r.details else 0
                cost = cost_usd(provider, model, r.details)
                status = "✓" if r.all_passed else "✗"
                header_line = (
                    f"**{tag}** — {status} · "
                    f"{tokens} tokens · {r.duration_s:.2f}s · {fmt_cost(cost)}"
                )
                if r.grader is not None:
                    header_line += f" · grader **{r.grader.score}/10**"
                elif r.grader_error:
                    header_line += f" · grader ⚠ {r.grader_error}"
                lines.append(header_line)
                lines.append("")
                lines.append("| field | expected | actual | ✓ |")
                lines.append("| --- | --- | --- | --- |")
                for c in r.checks:
                    mark = "✓" if c.passed else "✗"
                    lines.append(
                        f"| {c.name} | {c.expected} | {c.actual} | {mark} |"
                    )
                lines.append("")
                if r.grader is not None:
                    if r.grader.strengths:
                        lines.append("_Strengths:_")
                        for s in r.grader.strengths:
                            lines.append(f"- {s}")
                    if r.grader.weaknesses:
                        lines.append("_Weaknesses:_")
                        for w in r.grader.weaknesses:
                            lines.append(f"- {w}")
                    lines.append("")
                    lines.append(f"> {r.grader.explanation}")
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
        help="Print the report but do not append rows to results.jsonl.",
    )
    parser.add_argument(
        "--skip-grader",
        action="store_true",
        help="Skip the LLM-as-judge grader step (faster iteration; cheaper).",
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

    run_id = new_run_id()
    print(f"Run ID: {run_id}")

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

    grader_enabled = not args.skip_grader
    if grader_enabled:
        cases_by_id = {c.case_id: c for c in cases}
        print(f"\nGrading {len(results)} result(s) with {GRADER_PROVIDER}/{GRADER_MODEL}...")
        await grade_results(results, cases_by_id)

    report = render_report(
        results=results,
        matrix=runnable,
        prompt_versions=prompt_versions,
        case_ids=[c.case_id for c in cases],
        notes=args.notes,
        run_id=run_id,
        grader_enabled=grader_enabled,
    )

    print()
    print(report)

    if not args.no_append:
        JSONL_PATH.parent.mkdir(parents=True, exist_ok=True)
        expected_by_id = {c.case_id: c.expected for c in cases}
        rows = [result_to_row(r, run_id, expected_by_id[r.case_id]) for r in results]
        written = append_rows(JSONL_PATH, rows)
        print(f"Appended {written} row(s) to {JSONL_PATH.relative_to(API_ROOT)}")

    any_failures = any(not r.all_passed for r in results)
    return 1 if any_failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
