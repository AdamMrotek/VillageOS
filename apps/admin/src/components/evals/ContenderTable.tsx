import type { EvalRow } from "@/lib/evals/types";
import { formatCost } from "@/lib/evals/results";
import { Score } from "./Score";

interface ModelStats {
  provider: string;
  model: string;
  rulePass: number;
  ruleTotal: number;
  graderAvg: number | null;
  avgLatency: number;
  avgExtractionCost: number | null;
}

function aggregate(rows: EvalRow[]): ModelStats[] {
  const byModel = new Map<string, EvalRow[]>();
  for (const r of rows) {
    const key = `${r.provider}/${r.model}`;
    const list = byModel.get(key) ?? [];
    list.push(r);
    byModel.set(key, list);
  }
  return Array.from(byModel.values()).map((rs) => {
    const rulePass = rs.reduce((s, r) => s + (r.rule_pass_count ?? 0), 0);
    const ruleTotal = rs.reduce((s, r) => s + (r.rule_total ?? 0), 0);
    const graded = rs.filter((r) => r.grader);
    const graderAvg =
      graded.length === 0
        ? null
        : graded.reduce((s, r) => s + (r.grader?.score ?? 0), 0) / graded.length;
    const withLatency = rs.filter((r) => r.latency_s !== null);
    const avgLatency =
      withLatency.length === 0
        ? 0
        : withLatency.reduce((s, r) => s + (r.latency_s ?? 0), 0) /
          withLatency.length;
    const extractionCosts = rs
      .map((r) => r.extraction_cost_usd)
      .filter((v): v is number => v !== null && v !== undefined);
    const avgExtractionCost =
      extractionCosts.length === 0
        ? null
        : extractionCosts.reduce((s, v) => s + v, 0) / extractionCosts.length;
    return {
      provider: rs[0].provider,
      model: rs[0].model,
      rulePass,
      ruleTotal,
      graderAvg,
      avgLatency,
      avgExtractionCost,
    };
  });
}

function ruleClass(passed: number, total: number): string {
  if (total === 0) return "text-ink-mute";
  if (passed === total) return "text-accent-dark";
  if (passed === 0) return "text-cat-deadline";
  return "text-warm";
}

export function ContenderTable({ rows }: { rows: EvalRow[] }) {
  const stats = aggregate(rows);
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-background">
            <th className="text-eyebrow text-left px-3 py-2.5">Contender</th>
            <th className="text-eyebrow text-right px-3 py-2.5">Rules passed</th>
            <th className="text-eyebrow text-right px-3 py-2.5">Grader score</th>
            <th className="text-eyebrow text-right px-3 py-2.5">Latency</th>
            <th className="text-eyebrow text-right px-3 py-2.5">Extraction $</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr
              key={`${s.provider}/${s.model}`}
              className="border-t border-hairline"
            >
              <td className="px-3 py-2.5 text-mono text-sm">
                {s.provider}/{s.model}
              </td>
              <td
                className={`px-3 py-2.5 text-right text-mono font-semibold ${ruleClass(s.rulePass, s.ruleTotal)}`}
              >
                {s.ruleTotal > 0 ? `${s.rulePass}/${s.ruleTotal}` : "—"}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Score value={s.graderAvg} />
              </td>
              <td className="px-3 py-2.5 text-right text-mono">
                {s.avgLatency.toFixed(2)}s
              </td>
              <td className="px-3 py-2.5 text-right text-mono text-ink-mute">
                {formatCost(s.avgExtractionCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
