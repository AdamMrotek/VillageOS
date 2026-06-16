"""Provision the extraction-experiment dashboard in PostHog, as code.

The extraction model A/B (see ../EXPERIMENTS.md) emits client/server events —
`extraction_shown`, `extraction_accepted`, `extraction_discarded`,
`extraction_assigned`. This script builds the readout as a single PostHog
dashboard, reproducible and reviewable rather than hand-clicked. Rate tiles are
per-variant **tables** (not time-series), so each arm reads as a flat number over
the whole window — no drop-to-zero on idle days, which matters at sparse,
demo-account-driven traffic. Tiles:

  1. Conversion          — event ratio accepted/shown, by variant. NOT a funnel:
                            funnels count unique *persons*, so test accounts read
                            100%. This counts events — true per-extraction rate.
  2. Draft discard rate  — discarded/shown by variant; the strongest negative
                            quality signal (draft thrown away, not fixed).
  3. Fields edited       — mean `n_edited` on extraction_accepted, by variant.
  4. Fields edited by variant × input_type — same mean split by text/image, to
                            isolate Scout-vision edit-rate on real photos.
  5. Most-edited fields  — count of extraction_accepted broken down by the
                            `edited_fields` array (one bar per field — the
                            diagnostic the doc predicts spikes on `start_time`).
  6. Re-extract rate     — re_extract/shown by variant; a proxy for
                            dissatisfaction with the first draft.

It is **idempotent** — dashboard and insights are matched by exact name, so a
re-run updates the existing tiles in place rather than creating duplicates.

The guardrails the doc tracks (latency, cost/1k-chars, confidence) are NOT here:
they're emitted as the `extraction_completed` *server log*, not PostHog captures,
so they live in your log store, not in this dashboard.

Run from `apps/api/` (reads ./.env):

    python scripts/provision_posthog_dashboard.py            # create / update
    python scripts/provision_posthog_dashboard.py --dry-run  # print payloads, write nothing

Required env (in apps/api/.env, gitignored — these are management creds, distinct
from the `phc_…` capture key the app uses):

    POSTHOG_PERSONAL_API_KEY=phx_…   # Settings -> Personal API keys (Insight + Dashboard write)
    POSTHOG_PROJECT_ID=12345         # Settings -> Project ID

Optional:

    POSTHOG_API_HOST=https://eu.posthog.com   # defaults from POSTHOG_HOST's region
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

_API_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_API_ROOT / ".env")

DASHBOARD_NAME = "Extraction model A/B"
DASHBOARD_DESCRIPTION = (
    "Online readout for the extraction provider-stack experiment (control: openai "
    "gpt-4o-mini text + gpt-4o vision vs treatment: groq llama-4-scout for both paths, "
    "ADR-019). See apps/api/EXPERIMENTS.md. Provisioned by "
    "scripts/provision_posthog_dashboard.py — edit there, not here."
)
# Aggregate over the whole experiment, not a rolling window: the tiles are
# non-temporal tables/bars, so a fixed start keeps every demo-account observation
# in the readout rather than ageing the earliest ones out.
_DATE_RANGE = {"date_from": "2026-06-01"}


def _api_host() -> str:
    """REST management host. The capture host (eu.i.posthog.com) is *not* the API
    host (eu.posthog.com); derive the region from POSTHOG_HOST, allow override."""
    explicit = os.environ.get("POSTHOG_API_HOST")
    if explicit:
        return explicit.rstrip("/")
    capture = os.environ.get("POSTHOG_HOST", "https://eu.i.posthog.com")
    return capture.replace(".i.posthog.com", ".posthog.com").rstrip("/")


def _viz(source: dict) -> dict:
    """Wrap a query source (Trends/Funnels) in the InsightVizNode insights expect."""
    return {"kind": "InsightVizNode", "source": source}


# Breakdown filters. The single-key (`breakdown`) and multi-key (`breakdowns`)
# forms are both legal; the dual form drives the variant × input_type tile.
_BY_VARIANT = {"breakdown": "variant", "breakdown_type": "event"}
_BY_VARIANT_AND_INPUT = {
    "breakdowns": [
        {"property": "variant", "type": "event"},
        {"property": "input_type", "type": "event"},
    ]
}
# Boolean property filter: extraction_shown events that were re-extracts.
_REEXTRACT_FILTER = [{"key": "re_extract", "value": True, "operator": "exact", "type": "event"}]


def _events_node(
    event: str, name: str, *, math: str = "total", math_property: str | None = None, properties=None
) -> dict:
    node: dict = {"kind": "EventsNode", "event": event, "name": name, "math": math}
    if math_property:
        node["math_property"] = math_property
    if properties:
        node["properties"] = properties
    return node


def _trends(
    series: list[dict], *, display: str, breakdown_filter: dict, formula: str | None = None
) -> dict:
    trends_filter: dict = {"display": display}
    if formula:
        trends_filter["formula"] = formula
    return _viz(
        {
            "kind": "TrendsQuery",
            "series": series,
            "breakdownFilter": breakdown_filter,
            "dateRange": _DATE_RANGE,
            "trendsFilter": trends_filter,
        }
    )


def _insight_specs() -> list[dict]:
    """The dashboard tiles, each as {name, description, query}.

    Rate tiles use `display: ActionsTable` with a `100 * B / A` formula so each
    arm is a flat per-variant number over the whole window (no time axis, no
    drop-to-zero on idle days). Series order is the formula's alphabet: A first,
    B second.
    """
    return [
        {
            "name": "Extraction → event conversion (by variant)",
            "description": "Secondary metric. Event-level ratio accepted/shown per arm "
            "(100*B/A), as a per-variant table. NOT a funnel — funnels count unique persons, "
            "so a few test accounts read 100%; this counts events, so it reflects "
            "per-extraction conversion.",
            "query": _trends(
                [
                    _events_node("extraction_shown", "extraction_shown"),
                    _events_node("extraction_accepted", "extraction_accepted"),
                ],
                display="ActionsTable",
                breakdown_filter=_BY_VARIANT,
                formula="100 * B / A",
            ),
        },
        {
            "name": "Draft discard rate (by variant)",
            "description": "Negative signal. Share of shown drafts thrown away rather than "
            "fixed (100 * discarded/shown), per arm. A discard is worse than an edited draft, "
            "so a higher rate on an arm is the strongest quality red flag at low N.",
            "query": _trends(
                [
                    _events_node("extraction_shown", "extraction_shown"),
                    _events_node("extraction_discarded", "extraction_discarded"),
                ],
                display="ActionsTable",
                breakdown_filter=_BY_VARIANT,
                formula="100 * B / A",
            ),
        },
        {
            "name": "Fields edited per accepted draft (by variant)",
            "description": "Primary metric. Mean of n_edited on extraction_accepted, split by "
            "arm, as a table (control vs treatment numbers side by side). Lower = fewer fixes.",
            "query": _trends(
                [
                    _events_node(
                        "extraction_accepted",
                        "extraction_accepted",
                        math="avg",
                        math_property="n_edited",
                    )
                ],
                display="ActionsTable",
                breakdown_filter=_BY_VARIANT,
            ),
        },
        {
            "name": "Fields edited by variant × input type",
            "description": "Mean n_edited split by arm AND input_type (text / image / "
            "text+image). Isolates Scout-vision edit-rate on real photos — the riskiest part "
            "of the treatment arm (ADR-019), invisible in the variant-only average.",
            "query": _trends(
                [
                    _events_node(
                        "extraction_accepted",
                        "extraction_accepted",
                        math="avg",
                        math_property="n_edited",
                    )
                ],
                display="ActionsTable",
                breakdown_filter=_BY_VARIANT_AND_INPUT,
            ),
        },
        {
            "name": "Most-edited fields",
            "description": "Diagnostic. Count of extraction_accepted broken down by the "
            "edited_fields array — one bar per field users fix. Expected to spike on start_time.",
            "query": _trends(
                [_events_node("extraction_accepted", "extraction_accepted")],
                display="ActionsBarValue",
                breakdown_filter={"breakdown": "edited_fields", "breakdown_type": "event"},
            ),
        },
        {
            "name": "Re-extract rate (by variant)",
            "description": "Diagnostic. Share of shown drafts that were a re-extract of the "
            "same source (100 * re_extract/shown), per arm — a proxy for dissatisfaction with "
            "the first draft. A = all extraction_shown, B = those with re_extract = true.",
            "query": _trends(
                [
                    _events_node("extraction_shown", "extraction_shown"),
                    _events_node(
                        "extraction_shown", "extraction_reextracted", properties=_REEXTRACT_FILTER
                    ),
                ],
                display="ActionsTable",
                breakdown_filter=_BY_VARIANT,
                formula="100 * B / A",
            ),
        },
    ]


class PostHog:
    def __init__(self, host: str, project_id: str, token: str):
        self.base = f"{host}/api/projects/{project_id}"
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}"})

    def _get(self, path: str, **params) -> dict:
        r = self.session.get(f"{self.base}{path}", params=params, timeout=30)
        _raise(r)
        return r.json()

    def _write(self, method: str, path: str, body: dict) -> dict:
        r = self.session.request(method, f"{self.base}{path}", json=body, timeout=30)
        _raise(r)
        return r.json()

    def find_by_name(self, path: str, name: str) -> dict | None:
        """First result whose name matches exactly (search is fuzzy, so filter)."""
        for item in self._get(path, search=name, limit=100).get("results", []):
            if item.get("name") == name:
                return item
        return None

    def upsert_dashboard(self) -> dict:
        existing = self.find_by_name("/dashboards/", DASHBOARD_NAME)
        body = {"name": DASHBOARD_NAME, "description": DASHBOARD_DESCRIPTION}
        if existing:
            return self._write("PATCH", f"/dashboards/{existing['id']}/", body)
        return self._write("POST", "/dashboards/", body)

    def upsert_insight(self, spec: dict, dashboard_id: int) -> dict:
        existing = self.find_by_name("/insights/", spec["name"])
        body = {
            "name": spec["name"],
            "description": spec["description"],
            "query": spec["query"],
            "dashboards": [dashboard_id],
        }
        if existing:
            return self._write("PATCH", f"/insights/{existing['id']}/", body)
        return self._write("POST", "/insights/", body)


def _raise(r: requests.Response) -> None:
    if r.status_code >= 400:
        sys.exit(f"PostHog API {r.status_code} on {r.request.method} {r.url}\n{r.text}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="Print payloads without writing.")
    args = parser.parse_args()

    token = os.environ.get("POSTHOG_PERSONAL_API_KEY")
    project_id = os.environ.get("POSTHOG_PROJECT_ID")
    if not token or not project_id:
        sys.exit(
            "Missing POSTHOG_PERSONAL_API_KEY and/or POSTHOG_PROJECT_ID in apps/api/.env.\n"
            "Personal key: PostHog → Settings → Personal API keys (Insight + Dashboard write).\n"
            "Project ID:   PostHog → Settings → Project ID."
        )

    host = _api_host()
    specs = _insight_specs()

    if args.dry_run:
        print(f"DRY RUN — host {host}, project {project_id}\n")
        print(f"Dashboard: {DASHBOARD_NAME}\n")
        for spec in specs:
            print(f"  Insight: {spec['name']}")
            print(json.dumps(spec["query"], indent=2))
            print()
        print("No changes written.")
        return

    ph = PostHog(host, project_id, token)
    dashboard = ph.upsert_dashboard()
    print(f"Dashboard '{DASHBOARD_NAME}' -> id {dashboard['id']}")

    for spec in specs:
        insight = ph.upsert_insight(spec, dashboard["id"])
        print(f"  insight '{spec['name']}' -> id {insight['id']}")

    url = f"{host}/project/{project_id}/dashboard/{dashboard['id']}"
    print(f"\nDone. {url}")


if __name__ == "__main__":
    main()
