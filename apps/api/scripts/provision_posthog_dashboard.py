"""Provision the extraction-experiment dashboard in PostHog, as code.

The extraction model A/B (see ../EXPERIMENTS.md) emits three client/server
events — `extraction_shown`, `extraction_accepted`, `extraction_assigned`. This
script builds the readout for them as a single PostHog dashboard with three
tiles, so the dashboard is reproducible and reviewable rather than hand-clicked:

  1. Conversion         — event-level ratio accepted/shown, by variant. NOT a
                           funnel: PostHog funnels count unique *persons*, so a
                           handful of test accounts read 100%. This counts events
                           (extraction_accepted / extraction_shown) — true
                           per-extraction conversion.
  2. Fields edited       — mean of `n_edited` on extraction_accepted, by variant
  3. Most-edited fields  — count of extraction_accepted broken down by the
                           `edited_fields` array (PostHog explodes it, one bar
                           per field — the diagnostic the doc predicts spikes on
                           `start_time`)

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
    "Online readout for the extraction model experiment (control: groq llama-4-scout "
    "vs treatment: openai gpt-4o-mini). See apps/api/EXPERIMENTS.md. Provisioned by "
    "scripts/provision_posthog_dashboard.py — edit there, not here."
)
_DATE_RANGE = {"date_from": "-90d"}


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


def _insight_specs() -> list[dict]:
    """The three tiles, each as {name, description, query}."""
    by_variant = {"breakdown": "variant", "breakdown_type": "event"}
    return [
        {
            "name": "Extraction → event conversion (by variant)",
            "description": "Secondary metric. Event-level ratio accepted/shown per arm "
            "(100*B/A). NOT a funnel — funnels count unique persons, so a few test "
            "accounts read 100%; this counts events, so it reflects per-extraction conversion.",
            # Series order is the formula's alphabet: A = shown, B = accepted.
            "query": _viz(
                {
                    "kind": "TrendsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "extraction_shown", "name": "extraction_shown", "math": "total"},
                        {"kind": "EventsNode", "event": "extraction_accepted", "name": "extraction_accepted", "math": "total"},
                    ],
                    "breakdownFilter": by_variant,
                    "dateRange": _DATE_RANGE,
                    "trendsFilter": {"display": "ActionsLineGraph", "formula": "100 * B / A"},
                }
            ),
        },
        {
            "name": "Fields edited per accepted draft (by variant)",
            "description": "Primary metric. Mean of n_edited on extraction_accepted, "
            "split by arm. Lower = the draft needed fewer fixes.",
            "query": _viz(
                {
                    "kind": "TrendsQuery",
                    "series": [
                        {
                            "kind": "EventsNode",
                            "event": "extraction_accepted",
                            "name": "extraction_accepted",
                            "math": "avg",
                            "math_property": "n_edited",
                        }
                    ],
                    "breakdownFilter": by_variant,
                    "dateRange": _DATE_RANGE,
                    "trendsFilter": {"display": "ActionsLineGraph"},
                }
            ),
        },
        {
            "name": "Most-edited fields",
            "description": "Diagnostic. Count of extraction_accepted broken down by the "
            "edited_fields array — one bar per field users fix. Expected to spike on start_time.",
            "query": _viz(
                {
                    "kind": "TrendsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "extraction_accepted", "name": "extraction_accepted", "math": "total"}
                    ],
                    "breakdownFilter": {"breakdown": "edited_fields", "breakdown_type": "event"},
                    "dateRange": _DATE_RANGE,
                    "trendsFilter": {"display": "ActionsBarValue"},
                }
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
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
