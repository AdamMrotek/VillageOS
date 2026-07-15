"""Guardrail: the service-role Supabase client must stay on admin-only paths.

`get_admin_db()` bypasses RLS, so a route that injects it instead of
`get_user_db` would silently return every user's rows while staying green in
tests and mypy. These tests walk the AST of every module under `app/` and fail
CI when the admin client (or the raw ingredients to build one) shows up
outside the sanctioned locations.

Allowlist entries come in two granularities:

- "routers/admin.py"            — the whole file may use the symbol (for files
                                  that are admin-only end to end)
- "routers/extract.py::extract" — only that top-level function may use it (for
                                  one sanctioned exception in an otherwise
                                  user-scoped file)

If your change legitimately needs the service-role client (cron, cross-user
admin reads, auth.users mutations), add the function to ADMIN_DB_ALLOWLIST in
this file — the diff makes the RLS bypass explicit for review instead of
letting it land silently. Prefer the function-level form; only allowlist a
whole file when every route in it is admin-gated.
"""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# Locations allowed to reference get_admin_db, and why. Paths relative to
# app/; "path::function" scopes the exception to one top-level function.
ADMIN_DB_ALLOWLIST = {
    "core/db.py",  # defines it
    "core/experiments.py::_fetch_config",  # experiments config lives in a service-role table
    "core/experiments.py::capture_event",  # analytics writes (service-role table)
    "routers/account.py::delete_account",  # deleting an auth.users row requires the admin API
    "routers/admin.py",  # cross-user reads are the point; every route gated by require_admin
    "routers/extract.py::extract",  # usage_counters has no user RLS policy by design (ADR-017)
}

# Only core/db.py may construct a Supabase client; everything else goes
# through get_user_db / get_admin_db.
CLIENT_FACTORY_ALLOWLIST = {"core/db.py"}

# Only these may touch the secret key setting.
SECRET_KEY_ALLOWLIST = {
    "core/db.py",  # builds the service-role client from it
    "core/config.py",  # defines the setting
    # Presence checks only ("is admin db configured?"); never read the value out.
    "core/experiments.py::_fetch_config",
    "core/experiments.py::capture_event",
}


def _scopes_referencing(tree: ast.AST, symbol: str) -> set[str | None]:
    """Scopes in which the module uses `symbol`.

    Returns the name of the enclosing top-level function for each use, or None
    for uses at module/class level. A use is a Name or Attribute access, or a
    def of the symbol itself. Bare imports don't count (they can't leak data),
    but aliased imports are tracked so `import get_admin_db as x; x()` is
    still attributed to the scope that calls `x`.
    """
    aliases = {symbol}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == symbol and alias.asname:
                    aliases.add(alias.asname)

    scopes: set[str | None] = set()

    def visit(node: ast.AST, scope: str | None) -> None:
        for child in ast.iter_child_nodes(node):
            child_scope = scope
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if child.name == symbol:
                    scopes.add(scope)
                if scope is None:
                    child_scope = child.name
            elif isinstance(child, ast.Name) and child.id in aliases:
                scopes.add(scope)
            elif isinstance(child, ast.Attribute) and child.attr == symbol:
                scopes.add(scope)
            visit(child, child_scope)

    visit(tree, None)
    return scopes


def _sites_referencing(symbol: str) -> set[str]:
    """All use sites of `symbol` under app/, as 'path' or 'path::function'."""
    sites = set()
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        rel = str(path.relative_to(APP_DIR))
        for scope in _scopes_referencing(tree, symbol):
            sites.add(rel if scope is None else f"{rel}::{scope}")
    return sites


def _offenders(sites: set[str], allowlist: set[str]) -> set[str]:
    allowed_files = {entry for entry in allowlist if "::" not in entry}
    return {
        site for site in sites if site not in allowlist and site.split("::")[0] not in allowed_files
    }


def _stale_entries(sites: set[str], allowlist: set[str]) -> set[str]:
    referenced_files = {site.split("::")[0] for site in sites}
    stale = set()
    for entry in allowlist:
        if "::" in entry:
            if entry not in sites:
                stale.add(entry)
        elif entry not in referenced_files:
            stale.add(entry)
    return stale


class TestAdminDbBoundary:
    def test_get_admin_db_only_in_allowlisted_scopes(self):
        offenders = _offenders(_sites_referencing("get_admin_db"), ADMIN_DB_ALLOWLIST)
        assert not offenders, (
            f"get_admin_db (bypasses RLS) referenced outside the allowlist: {sorted(offenders)}. "
            "User-data routes must inject get_user_db so RLS enforces row ownership. "
            "If this path genuinely needs the service-role client, add the "
            "'path::function' entry to ADMIN_DB_ALLOWLIST in tests/test_db_boundary.py "
            "with a justification."
        )

    def test_allowlists_have_no_stale_entries(self):
        # Keeps the allowlists honest: entries whose sanctioned usage was
        # removed must be pruned so they can't hide a future reintroduction.
        for symbol, allowlist in [
            ("get_admin_db", ADMIN_DB_ALLOWLIST),
            ("create_client", CLIENT_FACTORY_ALLOWLIST),
            ("supabase_secret_key", SECRET_KEY_ALLOWLIST),
        ]:
            stale = _stale_entries(_sites_referencing(symbol), allowlist)
            assert not stale, f"Allowlist entries no longer reference {symbol}: {sorted(stale)}"

    def test_supabase_clients_only_built_in_core_db(self):
        offenders = _offenders(_sites_referencing("create_client"), CLIENT_FACTORY_ALLOWLIST)
        assert not offenders, (
            f"create_client called outside core/db.py: {sorted(offenders)}. "
            "All Supabase clients must come from get_user_db / get_admin_db."
        )

    def test_secret_key_only_read_in_allowlisted_scopes(self):
        offenders = _offenders(_sites_referencing("supabase_secret_key"), SECRET_KEY_ALLOWLIST)
        assert not offenders, (
            f"supabase_secret_key referenced outside its allowlist: {sorted(offenders)}. "
            "The secret key must never leave the client factory."
        )
