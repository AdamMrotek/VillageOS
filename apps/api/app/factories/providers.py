"""Factory for provider profiles — used by tests and seeding.

`ProviderProfileFactory.build()` returns a valid `ProviderProfileInput` with
defaults; pass keyword overrides for the fields under test. A monotonic sequence
keeps generated names/URLs unique across calls so a batch never collides.
"""

import itertools
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas.providers import (
    ProviderCategory,
    ProviderProfileInput,
    StoredProviderProfile,
)

# Module-level so every build() across a test run gets a distinct number.
_seq = itertools.count(1)


class ProviderProfileFactory:
    """Builds provider-profile models with sensible, unique-per-call defaults."""

    @classmethod
    def build(cls, **overrides) -> ProviderProfileInput:
        """A valid `ProviderProfileInput`. Override any field by keyword."""
        n = next(_seq)
        data = {
            "name": f"Provider {n}",
            "category": ProviderCategory.school,
            "description": f"Community provider number {n}.",
            "location": "Riverside",
            "website": f"https://provider-{n}.example.com",
            "tags": ["kids", "weekly"],
        }
        data.update(overrides)
        return ProviderProfileInput.model_validate(data)

    @classmethod
    def build_stored(cls, **overrides) -> StoredProviderProfile:
        """A persisted `StoredProviderProfile` — adds user_id + timestamps.

        `user_id`, `created_at` and `updated_at` may be overridden; everything
        else flows through to `build()`.
        """
        user_id = overrides.pop("user_id", None) or str(uuid4())
        now = datetime.now(UTC)
        created_at = overrides.pop("created_at", now)
        updated_at = overrides.pop("updated_at", now)
        base = cls.build(**overrides)
        return StoredProviderProfile(
            **base.model_dump(),
            user_id=user_id,
            created_at=created_at,
            updated_at=updated_at,
        )

    @classmethod
    def build_batch(cls, size: int, **overrides) -> list[ProviderProfileInput]:
        """`size` profiles, each unique unless an override pins a field."""
        return [cls.build(**overrides) for _ in range(size)]


def build_seed_providers() -> list[ProviderProfileInput]:
    """Curated, realistic providers for seeding the directory — one per category,
    assembled through the factory so they stay schema-valid. (Persisting these
    needs real auth users behind `provider_profiles.user_id`; this builds the
    rows, the seed script supplies the owners.)
    """
    return [
        ProviderProfileFactory.build(
            name="Oakfield Primary School",
            category=ProviderCategory.school,
            description="State primary school for ages 4–11 on Riverside Lane.",
            location="Riverside Lane",
            website="https://oakfield-primary.example.com",
            tags=["primary", "term-time", "ages-4-11"],
        ),
        ProviderProfileFactory.build(
            name="Riverside Junior Football Club",
            category=ProviderCategory.sports_club,
            description="Saturday-morning grassroots football for ages 5–12.",
            location="Riverside Recreation Ground",
            website="https://riverside-jfc.example.com",
            tags=["football", "weekend", "ages-5-12"],
        ),
        ProviderProfileFactory.build(
            name="Meadowbrook Community Library",
            category=ProviderCategory.library,
            description="Story time, homework club, and school-holiday workshops.",
            location="High Street",
            website="https://meadowbrook-library.example.com",
            tags=["reading", "free", "holiday-clubs"],
        ),
        ProviderProfileFactory.build(
            name="Greenway Parish Council",
            category=ProviderCategory.council,
            description="Local events, fêtes, and family activities in the parish.",
            location="Greenway",
            website="https://greenway-parish.example.com",
            tags=["community", "events", "fundraising"],
        ),
        ProviderProfileFactory.build(
            name="The Village Hall Playgroup",
            category=ProviderCategory.community,
            description="Weekday toddler playgroup with messy play and singing.",
            location="The Village Hall",
            website="https://village-hall-playgroup.example.com",
            tags=["toddlers", "weekday", "play"],
        ),
    ]
