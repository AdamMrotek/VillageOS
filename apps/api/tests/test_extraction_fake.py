"""The LLM_PROVIDER=fake seam that E2E depends on (see E2e_test_strategy.md).

If this seam silently breaks, calendar.spec.ts fails with an opaque 500 —
these tests pin it at the unit level first: fixture selection by trigger
phrase, the canned event's shape, and the loud failure on unmatched input.
No network is possible on this path (no instructor client is ever built).
"""

import json

import pytest

from app.services.extraction import extract_event
from app.services.extraction_fake import FIXTURES_DIR, fake_extract_event

BAKE_SALE_TEXT = (
    "Hi all! Just a reminder the Summer Bake Sale is this Friday 18th at 3pm "
    "in the school hall. Please bring £2 in a labelled envelope."
)


async def test_fake_provider_returns_triggered_fixture(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "fake")

    response = await extract_event(BAKE_SALE_TEXT)

    assert response.model_used == "fake"
    assert response.tokens_used == 0
    event = response.event
    assert event.title == "Summer Bake Sale"
    # Absolute date — the e2e spec freezes the browser clock to this week.
    assert event.start_time.isoformat().startswith("2026-09-18T15:00")
    assert [i.description for i in event.action_items] == [
        "Bring £2 in a labelled envelope",
        "Drop cake donations at the school office",
    ]


async def test_fake_provider_supports_return_details(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "fake")

    response, details = await extract_event(BAKE_SALE_TEXT, return_details=True)

    assert response.event.title == "Summer Bake Sale"
    assert details.provider == "fake"
    assert details.tokens_used == 0


async def test_fake_provider_unmatched_text_fails_loudly(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "fake")

    with pytest.raises(ValueError, match="known triggers"):
        await extract_event("nothing here matches any canned fixture at all")


def test_trigger_matching_is_case_insensitive():
    event = fake_extract_event("YEAR 3 MUSEUM TRIP ON TUESDAY — consent form needed")
    assert event.title == "Year 3 Museum Trip"


def test_every_fixture_parses_into_a_valid_event():
    """Editing a fixture must not be able to break e2e at runtime: each file's
    event must validate against the real response schema via its trigger."""
    fixtures = sorted(FIXTURES_DIR.glob("*.json"))
    assert fixtures, "no fake-extraction fixtures found"
    for path in fixtures:
        data = json.loads(path.read_text())
        event = fake_extract_event(f"some message mentioning {data['trigger']} somewhere")
        assert event.title
