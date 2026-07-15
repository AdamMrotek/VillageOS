import type { EvalRow, RunGroup } from "./types";

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

export type EvalKind = "all" | "text" | "vision";

export function rowKind(row: EvalRow): Exclude<EvalKind, "all"> {
  return row.input_type === "image" ? "vision" : "text";
}

export function filterRunsByKind(runs: RunGroup[], kind: EvalKind): RunGroup[] {
  if (kind === "all") return runs;
  return runs
    .map((run) => ({ ...run, rows: run.rows.filter((r) => rowKind(r) === kind) }))
    .filter((run) => run.rows.length > 0);
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
