"""Append-only JSONL storage for extraction eval runs.

results.jsonl is the source of truth — one row per
(case x provider x model x prompt_version x run_id). The markdown report is
a derived view rendered from rows in memory or filtered from this file.

Schema is intentionally flat-ish and forward-compatible: unknown fields on
read are preserved, new fields can be added without migrating old rows.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def new_run_id(now: datetime | None = None) -> str:
    """ISO-second UTC timestamp plus 4 hex chars, e.g. 2026-05-19T14-22-01Z-a1b2."""
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H-%M-%SZ") + "-" + secrets.token_hex(2)


def append_rows(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("a") as f:
        for row in rows:
            f.write(json.dumps(row, default=str))
            f.write("\n")
            count += 1
    return count


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def filter_rows(
    rows: list[dict[str, Any]],
    *,
    run_id: str | None = None,
    prompt_version: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> list[dict[str, Any]]:
    def keep(r: dict[str, Any]) -> bool:
        if run_id is not None and r.get("run_id") != run_id:
            return False
        if prompt_version is not None and r.get("prompt_version") != prompt_version:
            return False
        if provider is not None and r.get("provider") != provider:
            return False
        if model is not None and r.get("model") != model:
            return False
        return True

    return [r for r in rows if keep(r)]
