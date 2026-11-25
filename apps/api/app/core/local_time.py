"""The timezone VillageOS events happen in.

Events are local to the UK, so anything written for a person (an email, the
date of an all-day event in a calendar invite) uses UK time regardless of where
the Lambda runs.
"""

from datetime import UTC, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

LOCAL_TZ_NAME = "Europe/London"


def local_tz() -> tzinfo:
    try:
        return ZoneInfo(LOCAL_TZ_NAME)
    except ZoneInfoNotFoundError:  # no tz database on the host
        return UTC
