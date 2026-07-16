"""Deterministic extraction for E2E runs — the `LLM_PROVIDER=fake` seam.

Playwright can't intercept the server-side LLM call, so the e2e stack points
the API at this module instead: no instructor, no network, no API key. Each
fixture file in `extraction_fixtures/` carries the phrase that triggers it
("trigger") and the canned event it returns ("event") — shapes drawn from the
golden set so they stay realistic. Fixture dates are absolute: the browser
clock is frozen in the specs, and relative dates resolved against the real
server clock would drift out of the frozen week.

Never set LLM_PROVIDER=fake outside a test environment. See
E2e_test_strategy.md.
"""

import json
from pathlib import Path

from app.schemas.events import ParentEvent

FIXTURES_DIR = Path(__file__).parent / "extraction_fixtures"


def fake_extract_event(raw_text: str | None) -> ParentEvent:
    """Return the canned event whose trigger phrase appears in `raw_text`.

    Unmatched input raises rather than returning a default: a spec that sends
    the wrong trigger text should fail loudly at the seam, not downstream on a
    surprising event.
    """
    text = (raw_text or "").lower()
    triggers: list[str] = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        trigger = data["trigger"].lower()
        if trigger in text:
            return ParentEvent.model_validate(data["event"])
        triggers.append(trigger)
    raise ValueError(
        f"No fake-extraction fixture matches the input text; known triggers: {triggers}"
    )
