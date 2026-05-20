import { useEffect, useState } from "react";
import type { RunGroup } from "./types";
import { fetchRows, groupByRun } from "./lib/results";
import { RunCard } from "./components/RunCard";

export default function App() {
  const [runs, setRuns] = useState<RunGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRows()
      .then((rows) => setRuns(groupByRun(rows)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-20 pt-8">
      <header className="flex flex-wrap items-baseline justify-between gap-6 border-b-2 border-ink pb-4 mb-2">
        <h1 className="text-hero">Extraction eval</h1>
        <div className="text-mono text-eyebrow">
          {runs ? `${runs.length} run${runs.length === 1 ? "" : "s"}` : "loading…"}
        </div>
      </header>

      {error && (
        <div className="mt-8 rounded-xl border border-cat-deadline/40 bg-cat-deadline/8 px-5 py-4 text-sm text-cat-deadline">
          <div className="font-semibold mb-1">Failed to load results.jsonl</div>
          <div className="text-mono text-xs whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {runs && runs.length === 0 && !error && (
        <div className="mt-8 rounded-xl border border-hairline bg-surface px-6 py-8 text-center">
          <p className="text-ink">
            No eval runs yet. Run{" "}
            <code className="rounded bg-surface-alt px-2 py-0.5 text-mono text-sm">
              python -m evals.extraction.run
            </code>{" "}
            from <code className="text-mono">apps/api</code> to populate{" "}
            <code className="text-mono">results.jsonl</code>.
          </p>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="mt-8 flex flex-col gap-7">
          {runs.map((run, i) => (
            <RunCard key={run.run_id} run={run} isLatest={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
