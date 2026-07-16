"""Guardrail: every table in the public schema must have RLS enabled.

Row ownership is enforced at the database, not in route code (ADR-010): user
routes go through a JWT-scoped client and RLS decides what rows are visible. A
table shipped without `ENABLE ROW LEVEL SECURITY` is silently wide open — the
`authenticated`/`anon` PostgREST roles read every row, and PostgREST exposes it
directly over HTTP regardless of our FastAPI routes.

`test_db_boundary.py` guards the *endpoint* layer (which DB client a route uses);
this guards the *data* layer (whether RLS is on at all). They are orthogonal: a
table can have a perfectly user-scoped endpoint and still be unprotected. See
ADR-024 and TESTS.md.

Why parse migrations instead of querying a live database: the API test job runs
without a Supabase stack, and migrations are the source of truth for the schema
(the live DB is only their replay). This test therefore runs as a real CI gate
with no DB and no extra dependency — the same static-analysis philosophy as
test_db_boundary.py. It catches the failure mode that matters: a new
`CREATE TABLE` with no matching `ENABLE ROW LEVEL SECURITY` anywhere in the
migration set.

If a table legitimately must run without RLS, add it to RLS_EXEMPT with a
justification so the exception is explicit in review. (`usage_counters` is *not*
exempt: it has RLS on with no user policy — default-deny, server-only — which is
the most locked-down state, so it satisfies this guard as-is. See ADR-017.)
"""

import re
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"

# Tables in the public schema that deliberately run without RLS. Keep empty
# unless there is a documented reason; every entry weakens the guarantee.
RLS_EXEMPT: set[str] = set()

# A table reference: an optional (quoted) schema qualifier plus the name. Only
# unqualified names or an explicit `public.` schema are treated as public;
# `auth.users`, `storage.objects`, etc. are ignored so non-public DDL neither
# false-fails the guard nor is mistaken for a public table.
_TABLE = r'(?:"?(?P<schema>[a-zA-Z_][a-zA-Z0-9_]*)"?\s*\.\s*)?"?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)"?'

_CREATE_RE = re.compile(rf"^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?{_TABLE}", re.IGNORECASE)
_DROP_RE = re.compile(rf"^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?{_TABLE}", re.IGNORECASE)
_ENABLE_RE = re.compile(
    rf"^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?{_TABLE}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
    re.IGNORECASE,
)

# Strip `-- line` and `/* block */` comments so commented-out DDL can't match.
_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)


def _strip_comments(sql: str) -> str:
    return _LINE_COMMENT_RE.sub("", _BLOCK_COMMENT_RE.sub("", sql))


def _public_table(match: re.Match[str]) -> str | None:
    """The public-schema table name a statement targets, or None for other schemas."""
    schema = match.group("schema")
    if schema is not None and schema.lower() != "public":
        return None
    return match.group("name")


def _statements() -> list[str]:
    """All migration statements in apply order (files sorted, then in-file order).

    Splitting on `;` can fragment a function/DO body, but no fragment matches
    CREATE/DROP/ALTER-ENABLE for a *table*, so the DDL we track is unaffected.
    """
    stmts: list[str] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        stmts.extend(_strip_comments(path.read_text()).split(";"))
    return stmts


def _final_rls_state() -> dict[str, bool]:
    """Map each currently-active public table to whether RLS ends up enabled.

    Applied in migration order so a table's *final* state wins: create resets
    RLS to off, drop removes it entirely, enable turns it on — so a
    create → enable → drop → recreate sequence correctly ends up unprotected.
    """
    state: dict[str, bool] = {}
    for stmt in _statements():
        if m := _CREATE_RE.match(stmt):
            if (name := _public_table(m)) is not None:
                state[name] = False  # (re)create starts with RLS off
        elif m := _DROP_RE.match(stmt):
            if (name := _public_table(m)) is not None:
                state.pop(name, None)
        elif m := _ENABLE_RE.match(stmt):
            if (name := _public_table(m)) is not None and name in state:
                state[name] = True
    return state


class TestRlsCoverage:
    def test_migrations_exist(self):
        # A silently-empty glob (wrong path) would make the coverage test
        # vacuously pass; anchor it to reality.
        assert MIGRATIONS_DIR.is_dir(), f"migrations dir not found: {MIGRATIONS_DIR}"
        assert list(MIGRATIONS_DIR.glob("*.sql")), "no migration files found"

    def test_every_public_table_has_rls_enabled(self):
        unprotected = {t for t, enabled in _final_rls_state().items() if not enabled}
        unprotected -= RLS_EXEMPT
        assert not unprotected, (
            f"public tables created without ENABLE ROW LEVEL SECURITY: {sorted(unprotected)}. "
            "Every user-facing table must enable RLS (ADR-010) — without it the table is "
            "readable by any authenticated caller via PostgREST, independent of the API routes. "
            "Add `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` plus an ownership policy, or "
            "if it is deliberately server-only add it to RLS_EXEMPT in this file with a reason."
        )

    def test_no_stale_exemptions(self):
        # Keep RLS_EXEMPT honest: an entry for a table that no longer exists (or
        # that has since had RLS enabled) must be pruned so it can't mask a
        # future reintroduction.
        state = _final_rls_state()
        stale = {t for t in RLS_EXEMPT if t not in state or state[t]}
        assert not stale, f"RLS_EXEMPT entries no longer need an exemption: {sorted(stale)}"
