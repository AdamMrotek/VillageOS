"""Calendar invites: the iCalendar text, and the email that carries it.
Which invite is sent when: test_notifications.py."""

from datetime import UTC, datetime
from email import message_from_bytes
from email.message import EmailMessage as Mime
from email.policy import default
from typing import Any

from app.services import ics
from app.services.email import CalendarPart, EmailMessage, to_mime

NOW = datetime(2026, 11, 16, 9, 30, tzinfo=UTC)
APP_URL = "https://app.example"
RESERVATION = "77777777-7777-7777-7777-777777777777"
PROVIDER = "11111111-1111-1111-1111-111111111111"
ORGANIZER = ics.Person("events@notify.villageos.co.uk", "VillageOS")
PARENT = ics.Person("parent@example.com")


def _event(**overrides: Any) -> dict[str, Any]:
    event: dict[str, Any] = {
        "provider_id": PROVIDER,
        "title": "U9 Football Training",
        "start_time": "2026-11-20T16:00:00+00:00",
        "end_time": "2026-11-20T17:00:00+00:00",
        "is_all_day": False,
        "location": "Riverside Pitch 2",
        "description": None,
        "provider_profiles": {"name": "Riverside FC"},
    }
    event.update(overrides)
    return event


def _invite(method: ics.Method = "REQUEST", sequence: int = 0, spots: int = 2, **event: Any):
    return ics.build_invite(
        method=method,
        reservation_id=RESERVATION,
        sequence=sequence,
        event=_event(**event),
        spots=spots,
        organizer=ORGANIZER,
        attendee=PARENT,
        now=NOW,
        app_url=APP_URL,
    )


def _prop(text: str, name: str) -> str | None:
    """A property's value from an unfolded invite, matched by full name
    including parameters (e.g. "DTSTART;VALUE=DATE")."""
    for line in text.replace("\r\n ", "").split("\r\n"):
        key, _, value = line.partition(":")
        if key == name:
            return value
    return None


class TestInvite:
    def test_uid_is_fixed_per_reservation(self):
        uid = f"reservation-{RESERVATION}@villageos.co.uk"
        assert _prop(_invite(), "UID") == uid
        # An update, or a withdrawal, keeps it, so the calendar app changes the
        # event it already has rather than adding a second one.
        assert _prop(_invite(sequence=4, location="Elsewhere"), "UID") == uid
        assert _prop(_invite("CANCEL", sequence=5), "UID") == uid

    def test_sequence_is_the_one_given(self):
        assert _prop(_invite(sequence=7), "SEQUENCE") == "7"

    def test_a_request_adds_or_updates_a_confirmed_event(self):
        text = _invite()
        assert _prop(text, "METHOD") == "REQUEST"
        assert _prop(text, "STATUS") == "CONFIRMED"

    def test_a_cancel_takes_it_off(self):
        text = _invite("CANCEL")
        assert _prop(text, "METHOD") == "CANCEL"
        assert _prop(text, "STATUS") == "CANCELLED"

    def test_the_organizer_is_the_sender_and_the_parent_has_already_accepted(self):
        text = _invite()
        assert _prop(text, 'ORGANIZER;CN="VillageOS"') == "mailto:events@notify.villageos.co.uk"
        assert (
            _prop(text, "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE")
            == "mailto:parent@example.com"
        )

    def test_a_timed_event_is_written_in_utc(self):
        text = _invite()
        assert _prop(text, "DTSTART") == "20261120T160000Z"
        assert _prop(text, "DTEND") == "20261120T170000Z"
        assert _prop(text, "DTSTAMP") == "20261116T093000Z"

    def test_an_event_without_an_end_lasts_an_hour(self):
        assert _prop(_invite(end_time=None), "DTEND") == "20261120T170000Z"

    def test_an_all_day_event_falls_on_its_uk_date_in_summer_time(self):
        # UK midnight on 1 July is 23:00 on 30 June in UTC.
        text = _invite(is_all_day=True, start_time="2026-06-30T23:00:00+00:00")
        assert _prop(text, "DTSTART;VALUE=DATE") == "20260701"
        assert _prop(text, "DTEND;VALUE=DATE") == "20260702"

    def test_an_all_day_event_in_winter(self):
        text = _invite(is_all_day=True, start_time="2026-12-25T00:00:00+00:00")
        assert _prop(text, "DTSTART;VALUE=DATE") == "20261225"
        assert _prop(text, "DTEND;VALUE=DATE") == "20261226"

    def test_names_the_organiser_and_links_back(self):
        text = _invite(description="Bring boots")
        description = _prop(text, "DESCRIPTION") or ""
        assert description.startswith("Bring boots\\n\\nOrganised by Riverside FC.")
        assert "You reserved 2 spots." in description
        assert _prop(text, "URL") == f"{APP_URL}/discover/{PROVIDER}"

    def test_one_spot_is_singular(self):
        assert "You reserved 1 spot." in (_prop(_invite(spots=1), "DESCRIPTION") or "")

    def test_no_location_line_without_a_location(self):
        assert _prop(_invite(location=None), "LOCATION") is None

    def test_crlf_endings_and_one_event(self):
        text = _invite()
        assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
        assert text.endswith("END:VCALENDAR\r\n")
        assert text.count("BEGIN:VEVENT") == 1
        assert "\n" not in text.replace("\r\n", "")


class TestText:
    def test_special_characters_are_escaped(self):
        assert ics.escape_text("a,b;c\\d\ne\r\nf") == "a\\,b\\;c\\\\d\\ne\\nf"

    def test_short_lines_are_left_alone(self):
        assert ics.fold("SUMMARY:short") == "SUMMARY:short"

    def test_long_lines_fold_at_75_octets(self):
        folded = ics.fold("DESCRIPTION:" + "x" * 200)
        parts = folded.split("\r\n")
        assert all(len(p.encode()) <= 75 for p in parts)
        assert all(p.startswith(" ") for p in parts[1:])
        assert "".join(p[1:] if i else p for i, p in enumerate(parts)) == (
            "DESCRIPTION:" + "x" * 200
        )

    def test_folding_never_splits_a_multibyte_character(self):
        line = "SUMMARY:" + "é" * 80  # two bytes each
        parts = ics.fold(line).split("\r\n")
        assert all(len(p.encode()) <= 75 for p in parts)
        for p in parts:
            p.encode().decode()  # each part is valid UTF-8 on its own


def _parts(raw: bytes) -> list[Mime]:
    return list(message_from_bytes(raw, policy=default).walk())


class TestEmail:
    def _message(self, calendar: CalendarPart | None) -> EmailMessage:
        return EmailMessage(
            to="parent@example.com",
            subject="Booked: U9 Football Training",
            text="You've reserved 2 spots with Riverside FC.",
            unsubscribe_url=f"{APP_URL}/settings",
            calendar=calendar,
        )

    def test_carries_the_invite_inline_and_as_an_attachment(self):
        invite = _invite()
        raw = to_mime(self._message(CalendarPart("REQUEST", invite)), "VillageOS <e@x.test>")
        parts = _parts(raw)
        assert [p.get_content_type() for p in parts] == [
            "multipart/mixed",
            "multipart/alternative",
            "text/plain",
            "text/calendar",
            "application/ics",
        ]
        top, _, plain, calendar, attachment = parts
        assert top["List-Unsubscribe"] == f"<{APP_URL}/settings>"
        assert top["From"] == "VillageOS <e@x.test>"
        assert "Riverside FC" in plain.get_content()
        # Gmail and Outlook read the method off the MIME part.
        assert calendar.get_param("method") == "REQUEST"
        assert calendar.get_content().replace("\r\n", "\n") == invite.replace("\r\n", "\n")
        assert attachment.get_filename() == "invite.ics"

    def test_without_an_invite_it_is_plain_text(self):
        parts = _parts(to_mime(self._message(None), "e@x.test"))
        assert [p.get_content_type() for p in parts] == ["text/plain"]
