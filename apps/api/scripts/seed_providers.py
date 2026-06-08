"""Seed the provider directory with curated, realistic providers.

`build_seed_providers()` (in `app.factories`) builds schema-valid
`provider_profiles` *rows*, but each row needs an owning `auth.users` record
behind `provider_profiles.user_id`. This script supplies those owners: for every
curated provider it ensures a `provider` auth user exists, then upserts the
profile row through the same service the API uses.

It is **idempotent** — emails are derived deterministically from the provider
name, so re-running reuses existing auth users and refreshes their profile rows
rather than creating duplicates.

Run from `apps/api/` (service-role key required — it bypasses RLS):

    python scripts/seed_providers.py            # apply to the linked Supabase project
    python scripts/seed_providers.py --dry-run  # show what would change, touch nothing

Optional `SEED_PROVIDER_PASSWORD` env var sets a shared password for every seed
account (handy for logging in as a provider during a walkthrough); otherwise each
account gets a throwaway random password and is effectively read-only.
"""

import argparse
import os
import re
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv

# Make the `app` package importable when run as `python scripts/seed_providers.py`.
_API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_API_ROOT))
load_dotenv(_API_ROOT / ".env")

from app.core.db import get_admin_db  # noqa: E402
from app.factories import build_seed_providers  # noqa: E402
from app.schemas.providers import ProviderProfileInput  # noqa: E402
from app.services import providers as providers_service  # noqa: E402

# RFC 2606 reserves `.test`, so these addresses can never collide with real mail.
_EMAIL_DOMAIN = "seed.villageos.test"


def _email_for(name: str) -> str:
    """A stable, unique email for a provider, derived from its name."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{slug}@{_EMAIL_DOMAIN}"


def _existing_users_by_email(db) -> dict[str, str]:
    """email -> user_id for every existing auth user (paginated)."""
    by_email: dict[str, str] = {}
    page = 1
    while True:
        users = db.auth.admin.list_users(page=page, per_page=200)
        if not users:
            break
        for user in users:
            if user.email:
                by_email[user.email.lower()] = user.id
        page += 1
    return by_email


def _ensure_provider_user(db, email: str, name: str, password: str) -> str:
    """Create a confirmed `provider` auth user, returning its id.

    The `role` in `user_metadata` is what the `handle_new_user` trigger copies
    into `profiles.role`, so this is what makes the account a provider.
    """
    resp = db.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"role": "provider", "full_name": name},
        }
    )
    return resp.user.id


def seed(*, dry_run: bool = False) -> None:
    db = get_admin_db()
    shared_password = os.environ.get("SEED_PROVIDER_PASSWORD")
    existing = _existing_users_by_email(db)

    providers: list[ProviderProfileInput] = build_seed_providers()
    print(f"Seeding {len(providers)} providers into {_EMAIL_DOMAIN}\n")

    created = reused = 0
    for profile in providers:
        email = _email_for(profile.name)
        user_id = existing.get(email)

        if user_id:
            reused += 1
            action = "reuse "
        else:
            action = "create"
            if not dry_run:
                password = shared_password or secrets.token_urlsafe(16)
                user_id = _ensure_provider_user(db, email, profile.name, password)
            created += 1

        if not dry_run and user_id:
            providers_service.upsert_my_provider(db, user_id, profile)

        print(f"  [{action}] {profile.name:<34} {email}")

    verb = "Would seed" if dry_run else "Seeded"
    print(f"\n{verb}: {created} new, {reused} existing auth user(s) refreshed.")
    if dry_run:
        print("Dry run — no changes written.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing anything.",
    )
    args = parser.parse_args()
    seed(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
