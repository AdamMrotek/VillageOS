"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BarChart from "@/components/bar-chart";
import { createClient } from "@/lib/supabase/client";
import {
  ApiError,
  NotAuthenticated,
  adminGet,
  type ExtractionReadout,
} from "@/lib/api";

const C_SHOWN = "#8aa0b8";
const C_ACCEPTED = "#3f7d6e";
const C_CONTROL = "#3f7d6e";
const C_TREATMENT = "#b5703a";

type State =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExtractionReadout };

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adminGet<ExtractionReadout>(
          "/api/admin/experiments/extraction",
        );
        if (!cancelled) setState({ status: "ready", data });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof NotAuthenticated) {
          router.replace("/login");
        } else if (e instanceof ApiError && e.status === 403) {
          setState({ status: "forbidden" });
        } else {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Failed to load",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  if (state.status === "loading") {
    return (
      <div className="wrap center">
        <p className="sub">Loading…</p>
      </div>
    );
  }

  if (state.status === "forbidden") {
    return (
      <div className="wrap center">
        <h1>Not authorised</h1>
        <p className="sub">This account isn’t an admin.</p>
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="wrap center">
        <h1>Something went wrong</h1>
        <p className="err">{state.message}</p>
      </div>
    );
  }

  const { outcomes, field_edits } = state.data;

  return (
    <div className="wrap">
      <h1>Extraction A/B — live charts</h1>
      <p className="sub">
        control = OpenAI stack · treatment = Groq / Llama-4 Scout ·{" "}
        <button className="link" onClick={signOut}>
          sign out
        </button>
      </p>

      <BarChart
        title="Shown vs accepted, per model"
        subtitle="How many drafts each arm showed vs how many the user kept. The gap is drop-off; (unassigned) is a health check, not an arm."
        categories={outcomes.map((r) => r.model)}
        series={[
          { label: "Shown", color: C_SHOWN, values: outcomes.map((r) => r.shown) },
          { label: "Accepted", color: C_ACCEPTED, values: outcomes.map((r) => r.accepted) },
        ]}
      />

      <BarChart
        title="Field edit rate, per model"
        subtitle="Of the drafts each arm got accepted, what % needed this field fixed? (No start_date field — the date lives in start_time.)"
        categories={field_edits.map((r) => r.field)}
        suffix="%"
        series={[
          { label: "control", color: C_CONTROL, values: field_edits.map((r) => r.control_pct) },
          { label: "treatment", color: C_TREATMENT, values: field_edits.map((r) => r.treatment_pct) },
        ]}
      />

      {(outcomes.length === 0 || field_edits.length === 0) && (
        <p className="sub">
          No data yet — the experiment must be enabled (the <code>experiments</code>{" "}
          row) and events captured before charts populate.
        </p>
      )}

      <div className="caveat">
        <b>Read direction, not significance.</b> Low N — several bars can be 1–3
        events. These show <i>where</i> to look, not a verdict.
      </div>
    </div>
  );
}
