import { useEffect, useMemo, useState } from "react";
import type { RunGroup } from "./types";
import { fetchRows, groupByRun, filterRunsByKind, type EvalKind } from "./lib/results";
import { RunCard } from "./components/RunCard";

const TABS: { kind: EvalKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "text", label: "Text" },
  { kind: "vision", label: "Vision" },
];

export default function App() {
  const [runs, setRuns] = useState<RunGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<EvalKind>("all");

  useEffect(() => {
    fetchRows()
      .then((rows) => setRuns(groupByRun(rows)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const visible = useMemo(
    () => (runs ? filterRunsByKind(runs, kind) : null),
    [runs, kind]
  );

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-8">
      <header className="flex flex-wrap items-baseline justify-between gap-6 border-b-2 border-ink pb-4 mb-2">
        <h1 className="text-hero">Extraction eval</h1>
        <div className="text-mono text-eyebrow">
          {visible
            ? `${visible.length} run${visible.length === 1 ? "" : "s"}`
            : "loading…"}
        </div>
      </header>

      {runs && (
        <nav className="mt-5 flex gap-1 rounded-lg border border-hairline bg-surface p-1 w-fit">
          {TABS.map((tab) => {
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
                <span className={`ml-1.5 text-mono ${active ? "text-surface/70" : "text-ink-mute/70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {error && (
        <div className="mt-8 rounded-xl border border-cat-deadline/40 bg-cat-deadline/8 px-5 py-4 text-sm text-cat-deadline">
          <div className="font-semibold mb-1">Failed to load results.jsonl</div>
          <div className="text-mono text-xs whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {visible && visible.length === 0 && !error && (
        <div className="mt-8 rounded-xl border border-hairline bg-surface px-6 py-8 text-center">
          <p className="text-ink">
            {kind === "vision" ? "No vision runs yet. Run" : "No eval runs yet. Run"}{" "}
            <code className="rounded bg-surface-alt px-2 py-0.5 text-mono text-sm">
              python -m evals.extraction.run
              {kind === "vision" ? " --cases img_07_leaflet,img_08_whatsapp,img_09_photo_no_year" : ""}
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
    </div>
  );
}
