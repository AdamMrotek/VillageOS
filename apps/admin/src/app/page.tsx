"use client";

import { useMemo, useState } from "react";
import type { EvalRow, GoldenCase, RunGroup } from "@/lib/evals/types";
import {
  groupByRun,
  filterRunsByKind,
  type EvalKind,
} from "@/lib/evals/results";
import { RunCard } from "@/components/evals/RunCard";
import { GoldenCaseCard } from "@/components/evals/GoldenCaseCard";
import { GateScreen } from "@/components/GateScreen";
import { useAdminResource } from "@/lib/use-admin-resource";

type View = "results" | "golden";

const KIND_TABS: { kind: EvalKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "text", label: "Text" },
  { kind: "vision", label: "Vision" },
];

export default function EvalsPage() {
  // Results gate the page (the primary admin auth check); the golden set loads
  // alongside and surfaces its own loading/error state inside its view.
  const resultsState = useAdminResource<{ rows: EvalRow[] }>(
    "/api/admin/evals/results",
  );
  const goldenState = useAdminResource<{ cases: GoldenCase[] }>(
    "/api/admin/evals/golden",
  );

  const [view, setView] = useState<View>("results");
  const [kind, setKind] = useState<EvalKind>("all");

  const runs: RunGroup[] | null = useMemo(
    () =>
      resultsState.status === "ready"
        ? groupByRun(resultsState.data.rows)
        : null,
    [resultsState],
  );
  const visible = useMemo(
    () => (runs ? filterRunsByKind(runs, kind) : null),
    [runs, kind],
  );

  if (resultsState.status !== "ready") return <GateScreen state={resultsState} />;

  const goldenCount =
    goldenState.status === "ready" ? goldenState.data.cases.length : null;

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-8">
      <header className="flex flex-wrap items-baseline justify-between gap-6 border-b-2 border-ink pb-4 mb-2">
        <h1 className="text-hero">Extraction eval</h1>
        <div className="text-mono text-eyebrow">
          {view === "results"
            ? visible
              ? `${visible.length} run${visible.length === 1 ? "" : "s"}`
              : "loading…"
            : goldenCount === null
              ? "loading…"
              : `${goldenCount} case${goldenCount === 1 ? "" : "s"}`}
        </div>
      </header>

      {/* Results vs Golden set */}
      <nav className="mt-5 flex gap-1 rounded-lg border border-hairline bg-surface p-1 w-fit">
        {(
          [
            ["results", "Results"],
            ["golden", "Golden set"],
          ] as [View, string][]
        ).map(([v, label]) => {
          const active = v === view;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                active
                  ? "bg-ink text-surface"
                  : "text-ink-mute hover:bg-surface-alt hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {view === "results" ? (
        <>
          {runs && (
            <nav className="mt-4 flex gap-1 rounded-lg border border-hairline bg-surface p-1 w-fit">
              {KIND_TABS.map((tab) => {
                const count = filterRunsByKind(runs, tab.kind).length;
                const active = tab.kind === kind;
                return (
                  <button
                    key={tab.kind}
                    onClick={() => setKind(tab.kind)}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                      active
                        ? "bg-ink text-surface"
                        : "text-ink-mute hover:bg-surface-alt hover:text-ink"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`ml-1.5 text-mono ${active ? "text-surface/70" : "text-ink-mute/70"}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
          )}

          {visible && visible.length === 0 && (
            <div className="mt-8 rounded-xl border border-hairline bg-surface px-6 py-8 text-center">
              <p className="text-ink">
                {kind === "vision"
                  ? "No vision runs yet. Run"
                  : "No eval runs yet. Run"}{" "}
                <code className="rounded bg-surface-alt px-2 py-0.5 text-mono text-sm">
                  python -m evals.extraction.run
                  {kind === "vision"
                    ? " --cases img_07_leaflet,img_08_whatsapp,img_09_photo_no_year"
                    : ""}
                </code>{" "}
                from <code className="text-mono">apps/api</code> to populate{" "}
                <code className="text-mono">results.jsonl</code>.
              </p>
            </div>
          )}

          {visible && visible.length > 0 && (
            <div className="mt-8 flex flex-col gap-7">
              {visible.map((run, i) => (
                <RunCard key={run.run_id} run={run} isLatest={i === 0} />
              ))}
            </div>
          )}
        </>
      ) : (
        <GoldenSetView state={goldenState} />
      )}
    </div>
  );
}

function GoldenSetView({
  state,
}: {
  state: ReturnType<typeof useAdminResource<{ cases: GoldenCase[] }>>;
}) {
  if (state.status === "loading") {
    return <p className="mt-8 text-sm text-muted-foreground">Loading golden set…</p>;
  }
  if (state.status === "forbidden") {
    return <p className="mt-8 text-sm text-muted-foreground">Not authorised.</p>;
  }
  if (state.status === "error") {
    return <p className="mt-8 text-sm text-destructive">{state.message}</p>;
  }

  const { cases } = state.data;
  return (
    <>
      <p className="mt-4 text-meta max-w-2xl">
        The cases the eval is graded against (
        <code className="text-mono">apps/api/tests/golden</code>). Each shows the
        input text the model sees and the partial expected result — only the
        fields the dataset asserts on.
      </p>
      {cases.length === 0 ? (
        <div className="mt-8 rounded-xl border border-hairline bg-surface px-6 py-8 text-center text-ink">
          No golden cases found.
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-hairline bg-surface divide-y divide-hairline overflow-hidden">
          {cases.map((c) => (
            <GoldenCaseCard key={c.case_id} c={c} />
          ))}
        </div>
      )}
    </>
  );
}
