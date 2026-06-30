import type { EvalRow, RunGroup } from "@/lib/evals/types";
import { formatCost } from "@/lib/evals/results";
import { ContenderTable } from "./ContenderTable";
import { CaseDetail } from "./CaseDetail";
import { Score } from "./Score";

function uniqueSorted<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values)).sort();
}

function modeLabel(mode: string | null): string {
  if (!mode) return "Unknown";
  // Keep short all-caps tokens (TOOLS, JSON, MD) uppercase; title-case longer ones.
  if (mode.length <= 5) return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
  return mode;
}

interface ModelStat {
  key: string;
  provider: string;
  model: string;
  rulePassRate: number | null;
  graderAvg: number | null;
  avgTokens: number;
  avgLatency: number;
  avgCost: number | null;
}

function aggregateRun(rows: EvalRow[]): ModelStat[] {
  const byModel = new Map<string, EvalRow[]>();
  for (const r of rows) {
    const key = `${r.provider}/${r.model}`;
    const list = byModel.get(key) ?? [];
    list.push(r);
    byModel.set(key, list);
  }
  return Array.from(byModel.entries()).map(([key, rs]) => {
    const rulePass = rs.reduce((s, r) => s + (r.rule_pass_count ?? 0), 0);
    const ruleTotal = rs.reduce((s, r) => s + (r.rule_total ?? 0), 0);
    const graded = rs.filter((r) => r.grader);
    const graderAvg =
      graded.length === 0
        ? null
        : graded.reduce((s, r) => s + (r.grader?.score ?? 0), 0) / graded.length;
    const withTokens = rs.filter((r) => r.tokens_used !== null);
    const avgTokens =
      withTokens.length === 0
        ? 0
        : Math.round(
            withTokens.reduce((s, r) => s + (r.tokens_used ?? 0), 0) /
              withTokens.length
          );
    const avgLatency =
      withTokens.length === 0
        ? 0
        : withTokens.reduce((s, r) => s + (r.latency_s ?? 0), 0) /
          withTokens.length;
    const extractionCosts = rs
      .map((r) => r.extraction_cost_usd)
      .filter((v): v is number => v !== null && v !== undefined);
    const avgCost =
      extractionCosts.length === 0
        ? null
        : extractionCosts.reduce((s, v) => s + v, 0) / extractionCosts.length;
    return {
      key,
      provider: rs[0].provider,
      model: rs[0].model,
      rulePassRate: ruleTotal === 0 ? null : rulePass / ruleTotal,
      graderAvg,
      avgTokens,
      avgLatency,
      avgCost,
    };
  });
}

function pickBestScore(stats: ModelStat[]): ModelStat | null {
  if (stats.length === 0) return null;
  return [...stats].sort((a, b) => {
    const ag = a.graderAvg ?? -Infinity;
    const bg = b.graderAvg ?? -Infinity;
    if (bg !== ag) return bg - ag;
    const ar = a.rulePassRate ?? -Infinity;
    const br = b.rulePassRate ?? -Infinity;
    return br - ar;
  })[0];
}

function normalize(
  values: (number | null)[],
  higherBetter: boolean
): (number | null)[] {
  const finite = values.filter((v): v is number => v !== null);
  if (finite.length === 0) return values.map(() => null);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return values.map((v) => (v === null ? null : 0.5));
  return values.map((v) => {
    if (v === null) return null;
    const n = (v - min) / (max - min);
    return higherBetter ? n : 1 - n;
  });
}

function pickBestBalance(stats: ModelStat[]): ModelStat | null {
  if (stats.length === 0) return null;
  if (stats.length === 1) return stats[0];
  const graderNorm = normalize(stats.map((s) => s.graderAvg), true);
  const ruleNorm = normalize(stats.map((s) => s.rulePassRate), true);
  const tokensNorm = normalize(stats.map((s) => s.avgTokens), false);
  const latencyNorm = normalize(stats.map((s) => s.avgLatency), false);
  const costNorm = normalize(stats.map((s) => s.avgCost), false);
  const ranked = stats.map((s, i) => {
    const parts = [
      graderNorm[i],
      ruleNorm[i],
      tokensNorm[i],
      latencyNorm[i],
      costNorm[i],
    ].filter((v): v is number => v !== null);
    const score = parts.length === 0 ? -Infinity : parts.reduce((a, b) => a + b, 0) / parts.length;
    return { stat: s, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0].stat;
}

function HighlightCard({
  label,
  stat,
  note,
}: {
  label: string;
  stat: ModelStat | null;
  note?: string;
}) {
  if (!stat) {
    return (
      <div className="rounded-xl border border-hairline bg-surface-alt p-4">
        <div className="text-eyebrow">{label}</div>
        <div className="mt-2 text-sm text-ink-mute">No data</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-hairline bg-surface-alt p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-eyebrow">{label}</span>
        <Score value={stat.graderAvg} />
      </div>
      <div className="mt-2 text-mono text-sm text-ink">
        {stat.provider}/{stat.model}
      </div>
      {note && <div className="text-meta mt-0.5">{note}</div>}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-eyebrow">Avg time</dt>
          <dd className="text-mono text-ink mt-0.5">
            {stat.avgLatency.toFixed(2)}s
          </dd>
        </div>
        <div>
          <dt className="text-eyebrow">Avg tokens</dt>
          <dd className="text-mono text-ink mt-0.5">{stat.avgTokens}</dd>
        </div>
        <div>
          <dt className="text-eyebrow">Price</dt>
          <dd className="text-mono text-ink mt-0.5">{formatCost(stat.avgCost)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function RunCard({
  run,
  isLatest,
}: {
  run: RunGroup;
  isLatest: boolean;
}) {
  const promptVersions = uniqueSorted(run.rows.map((r) => r.prompt_version));
  const caseIds = uniqueSorted(run.rows.map((r) => r.case_id));
  const graderModels = uniqueSorted(
    run.rows.map((r) => r.grader?.model).filter((m): m is string => Boolean(m))
  );

  const comboSet = new Set<string>();
  for (const r of run.rows) {
    if (!r.instructor_mode) continue;
    comboSet.add(`${r.instructor_mode}|${r.prompt_version}`);
  }
  const title = Array.from(comboSet)
    .sort()
    .map((c) => {
      const [mode, version] = c.split("|");
      return `${modeLabel(mode)} with Prompt ${version}`;
    })
    .join(", ");

  const stats = aggregateRun(run.rows);
  const bestScore = pickBestScore(stats);
  const bestBalance = pickBestBalance(stats);
  const sameBest = bestScore && bestBalance && bestScore.key === bestBalance.key;

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-7">
      <header className="flex flex-wrap items-baseline gap-4 pb-4 border-b border-hairline">
        <h2 className="text-title">{title}</h2>
        <span className="text-meta">{run.timestamp.replace(/\s*UTC\s*$/i, "")}</span>
        <div className="ml-auto flex items-center gap-2">
          {isLatest && (
            <span className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] bg-accent text-accent-foreground">
              Latest
            </span>
          )}
          <span className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] bg-surface-alt text-ink-soft">
            {run.rows.length} row{run.rows.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <HighlightCard label="Best model" stat={bestScore} />
        <HighlightCard
          label="Best balance"
          stat={bestBalance}
          note={sameBest ? "Same model leads on score and balance" : undefined}
        />
      </div>

      <dl className="mt-5 grid gap-2 gap-x-6 mb-6 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))] text-xs">
        {[
          ["Cases", caseIds.join(", ")],
          ["Grader (judge)", graderModels.length ? graderModels.join(", ") : "disabled"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-eyebrow">{k}</dt>
            <dd className="text-mono text-ink mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-8">
        {promptVersions.map((version) => {
          const promptRows = run.rows.filter((r) => r.prompt_version === version);
          return (
            <div key={version}>
              <h3 className="text-heading mb-3">
                Prompt{" "}
                <code className="rounded bg-surface-alt px-2 py-0.5 text-mono text-sm">
                  {version}
                </code>
              </h3>
              <ContenderTable rows={promptRows} />
              {caseIds.map((caseId) => {
                const caseRows = promptRows.filter((r) => r.case_id === caseId);
                if (caseRows.length === 0) return null;
                return <CaseDetail key={caseId} caseId={caseId} rows={caseRows} />;
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
