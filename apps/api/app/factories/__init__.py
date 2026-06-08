"""Model factories — one place to build valid domain objects.

A factory hands back a fully-valid model with sensible defaults; callers pass
keyword overrides for only the fields they care about. The same factory serves
two callers:

* **Tests** — `ProviderProfileFactory.build(name="…")` keeps fixtures terse and
  resilient: add a required field to a schema and every test keeps compiling
  because the factory fills it.
* **Seeding** — curated builders like `build_seed_providers()` use the factory
  to assemble realistic catalog rows, so seed data can never drift out of sync
  with the schema.

This is the pattern going forward: one `*Factory` per model under
`app/factories/`, dependency-free, mirroring the hand-rolled style already used
in `app/services/demo_seed.py`.
"""

from app.factories.providers import ProviderProfileFactory, build_seed_providers

__all__ = ["ProviderProfileFactory", "build_seed_providers"]
