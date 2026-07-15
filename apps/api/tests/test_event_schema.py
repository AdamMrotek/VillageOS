"""ParentEvent validation: end_time must be strictly after start_time (the DB
enforces the same via the end_after_start CHECK constraint)."""

import pytest
from pydantic import ValidationError

from app.schemas.events import ParentEvent

BASE = {
    "title": "Summer Bake Sale",
    "event_type": "school",
    "start_time": "2026-07-20T14:00:00Z",
    "confidence": 1.0,
}


class TestEndAfterStart:
    def test_no_end_time_passes(self):
        assert ParentEvent(**BASE).end_time is None

    def test_end_after_start_passes(self):
        event = ParentEvent(**BASE, end_time="2026-07-20T16:00:00Z")
        assert event.end_time is not None

    def test_end_equal_to_start_rejected(self):
        with pytest.raises(ValidationError, match="end_time must be after start_time"):
            ParentEvent(**BASE, end_time="2026-07-20T14:00:00Z")

    def test_end_before_start_rejected(self):
        with pytest.raises(ValidationError, match="end_time must be after start_time"):
            ParentEvent(**BASE, end_time="2026-07-20T09:00:00Z")

    def test_end_midnight_of_start_day_rejected(self):
        # What the web form used to submit when the end date matched the start
        # date but the end time was left blank.
        with pytest.raises(ValidationError, match="end_time must be after start_time"):
            ParentEvent(**BASE, end_time="2026-07-20T00:00:00Z")
