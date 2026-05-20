import type { EvalRow, RunGroup } from "../types";

export async function fetchRows(): Promise<EvalRow[]> {
  // public/results.jsonl is a symlink to apps/api/evals/extraction/results.jsonl
  // so the dev server always serves the latest data.
  const res = await fetch("/results.jsonl", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to load results.jsonl (${res.status}). ` +
        `Ensure apps/eval-viewer/public/results.jsonl exists (symlink to the API JSONL).`
    );
  }
  const text = await res.text();
  const rows: EvalRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines; the JSONL is append-only and partial writes are
      // unlikely but not impossible.
    }
  }
  return rows;
}

export function groupByRun(rows: EvalRow[]): RunGroup[] {
  const byRun = new Map<string, EvalRow[]>();
  for (const r of rows) {
    const list = byRun.get(r.run_id) ?? [];
    list.push(r);
    byRun.set(r.run_id, list);
  }
  // run_id is `YYYY-MM-DDTHH-MM-SSZ-xxxx` — lexical sort matches chronological.
  return Array.from(byRun.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([run_id, rs]) => ({
      run_id,
      timestamp: prettyTimestamp(run_id),
      rows: rs,
    }));
}

function prettyTimestamp(runId: string): string {
  // 2026-05-19T21-02-37Z-15ed -> 2026-05-19 21:02 UTC
  const stamp = runId.replace(/-[0-9a-f]{4}$/, "");
  const m = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/);
  if (!m) return runId;
  return `${m[1]} ${m[2]}:${m[3]} UTC`;
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return `$${(value * 1000).toFixed(4)}/1k`;
}

export function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "score-na";
  if (score >= 8) return "score-good";
  if (score >= 5) return "score-mid";
  return "score-bad";
}
