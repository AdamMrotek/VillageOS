"""The provider factory — the reference for the factories-for-tests pattern."""

from app.factories.providers import ProviderProfileFactory, build_seed_providers
from app.schemas.providers import (
    ProviderCategory,
    ProviderProfileInput,
    StoredProviderProfile,
)


class TestBuild:
    def test_returns_a_valid_input(self):
        profile = ProviderProfileFactory.build()
        assert isinstance(profile, ProviderProfileInput)
        assert profile.name  # required field is populated
        assert profile.category in ProviderCategory

    def test_overrides_win(self):
        profile = ProviderProfileFactory.build(
            name="Sunnydale Nursery", category=ProviderCategory.community
        )
        assert profile.name == "Sunnydale Nursery"
        assert profile.category == ProviderCategory.community

    def test_successive_builds_are_unique(self):
        # The sequence keeps generated names distinct so a batch never collides.
        names = {ProviderProfileFactory.build().name for _ in range(5)}
        assert len(names) == 5


class TestBuildStored:
    def test_adds_user_id_and_timestamps(self):
        stored = ProviderProfileFactory.build_stored()
        assert isinstance(stored, StoredProviderProfile)
        assert stored.user_id
        assert stored.created_at is not None
        assert stored.updated_at is not None

    def test_user_id_override(self):
        stored = ProviderProfileFactory.build_stored(user_id="abc-123")
        assert stored.user_id == "abc-123"

    def test_passes_input_overrides_through(self):
        stored = ProviderProfileFactory.build_stored(name="Greenfields")
        assert stored.name == "Greenfields"


class TestBuildBatch:
    def test_size_and_uniqueness(self):
        batch = ProviderProfileFactory.build_batch(3)
        assert len(batch) == 3
        assert len({p.name for p in batch}) == 3

    def test_pinned_override_applies_to_all(self):
        batch = ProviderProfileFactory.build_batch(3, category=ProviderCategory.library)
        assert all(p.category == ProviderCategory.library for p in batch)


class TestSeedProviders:
    def test_returns_realistic_distinct_providers(self):
        providers = build_seed_providers()
        assert len(providers) >= 5
        assert all(isinstance(p, ProviderProfileInput) for p in providers)
        # Distinct names and a spread of categories — a believable directory.
        assert len({p.name for p in providers}) == len(providers)
        assert len({p.category for p in providers}) >= 4
