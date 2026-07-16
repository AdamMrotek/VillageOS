"""The LLM_PROVIDER=fake seam that E2E depends on (see E2e_test_strategy.md).

If this seam silently breaks, calendar.spec.ts fails with an opaque 500 —
these tests pin it at the unit level first: fixture selection by trigger
phrase, the canned event's shape, and the loud failure on unmatched input.
No network is possible on this path (no instructor client is ever built).
"""

import json

import pytest

from app.schemas.events import ParentEvent
from app.services.extraction import extract_event
from app.services.extraction_fake import FIXTURES_DIR, fake_extract_event


def _enable_fake(monkeypatch):
    """Both gates extract_event requires before serving canned fixtures."""
    monkeypatch.setenv("LLM_PROVIDER", "fake")
    monkeypatch.setenv("E2E_FAKE_LLM", "1")


BAKE_SALE_TEXT = (
    "Hi all! Just a reminder the Summer Bake Sale is this Friday 18th at 3pm "
    "in the school hall. Please bring £2 in a labelled envelope."
)


async def test_fake_provider_returns_triggered_fixture(monkeypatch):
    _enable_fake(monkeypatch)

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
    _enable_fake(monkeypatch)

    response, details = await extract_event(BAKE_SALE_TEXT, return_details=True)

    assert response.event.title == "Summer Bake Sale"
    assert details.provider == "fake"
    assert details.tokens_used == 0


async def test_fake_provider_unmatched_text_fails_loudly(monkeypatch):
    _enable_fake(monkeypatch)

    with pytest.raises(ValueError, match="known triggers"):
        await extract_event("nothing here matches any canned fixture at all")


async def test_fake_provider_refuses_without_opt_in(monkeypatch):
    # LLM_PROVIDER=fake alone must not serve fixtures — the E2E_FAKE_LLM gate
    # keeps a stray prod misconfig from silently returning canned events.
    monkeypatch.setenv("LLM_PROVIDER", "fake")
    monkeypatch.delenv("E2E_FAKE_LLM", raising=False)

    with pytest.raises(ValueError, match="E2E_FAKE_LLM"):
        await extract_event(BAKE_SALE_TEXT)


def test_trigger_matching_is_case_insensitive():
    event = fake_extract_event("YEAR 3 MUSEUM TRIP ON TUESDAY — consent form needed")
    assert event.title == "Year 3 Museum Trip"


def test_every_fixture_parses_into_a_valid_event():
    """Editing a fixture must not be able to break e2e at runtime: each file's
    own event payload must validate against the real response schema. Validate
    data["event"] directly (not via trigger routing) so a trigger collision
    can't let one fixture pass in place of another."""
    fixtures = sorted(FIXTURES_DIR.glob("*.json"))
    assert fixtures, "no fake-extraction fixtures found"
    for path in fixtures:
        data = json.loads(path.read_text())
        event = ParentEvent.model_validate(data["event"])
        assert event.title
