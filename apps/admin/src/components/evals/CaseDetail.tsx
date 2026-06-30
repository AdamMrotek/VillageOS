import type { EvalRow } from "@/lib/evals/types";
import { formatCost } from "@/lib/evals/results";
import { Score } from "./Score";
import { GoldenImage } from "./GoldenImage";

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Contender({ row }: { row: EvalRow }) {
  const header = (
    <div className="flex flex-wrap items-baseline gap-3 mb-2">
      <span className="text-mono font-semibold">
        {row.provider}/{row.model}
      </span>
      {row.error ? (
        <span className="text-meta text-cat-deadline">extraction failed</span>
      ) : (
        <span className="text-meta">
          {row.rule_pass_count}/{row.rule_total} rules · {row.tokens_used ?? 0}{" "}
          tok · {row.latency_s?.toFixed(2) ?? "?"}s ·{" "}
          {formatCost(row.extraction_cost_usd)}
          {row.input_type === "image" && row.image_bytes != null
            ? ` · img ${Math.round(row.image_bytes / 1024)} KB`
            : ""}
        </span>
      )}
      {row.grader && <Score value={row.grader.score} />}
    </div>
  );

  return (
    <div className="py-4 border-t border-hairline first:border-t-0 first:pt-2">
      {header}

      {row.error ? (
        <pre className="rounded-r-lg border-l-4 border-cat-deadline bg-cat-deadline/8 px-3 py-2 text-xs text-mono text-cat-deadline whitespace-pre-wrap break-words">
          {row.error}
        </pre>
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-background">
                <th className="text-eyebrow text-left px-3 py-2">Field</th>
                <th className="text-eyebrow text-left px-3 py-2">Expected</th>
                <th className="text-eyebrow text-left px-3 py-2">Actual</th>
                <th className="text-eyebrow text-left px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {row.rule_checks.map((c) => (
                <tr key={c.name} className="border-t border-hairline">
                  <td className="px-3 py-2 text-mono">{c.name}</td>
                  <td className="px-3 py-2 text-ink-soft">{fmt(c.expected)}</td>
                  <td className="px-3 py-2 text-ink-soft">{fmt(c.actual)}</td>
                  <td
                    className={`px-3 py-2 text-mono font-semibold ${c.passed ? "text-accent-dark" : "text-cat-deadline"}`}
                  >
                    {c.passed ? "✓" : "✗"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {row.grader ? (
        <div className="mt-3 space-y-3">
          {(row.grader.strengths.length > 0 || row.grader.weaknesses.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg bg-accent-soft/60 px-4 py-3">
                <div className="text-eyebrow mb-1.5">Strengths</div>
                <ul className="list-disc pl-5 space-y-0.5 text-sm">
                  {row.grader.strengths.length > 0 ? (
                    row.grader.strengths.map((s, i) => <li key={i}>{s}</li>)
                  ) : (
                    <li className="italic text-ink-mute">none</li>
                  )}
                </ul>
              </div>
              <div className="rounded-lg bg-warm-surface/60 px-4 py-3">
                <div className="text-eyebrow mb-1.5">Weaknesses</div>
                <ul className="list-disc pl-5 space-y-0.5 text-sm">
                  {row.grader.weaknesses.length > 0 ? (
                    row.grader.weaknesses.map((w, i) => <li key={i}>{w}</li>)
                  ) : (
                    <li className="italic text-ink-mute">none</li>
                  )}
                </ul>
              </div>
            </div>
          )}
          {row.grader.explanation && (
            <blockquote className="rounded-r-lg border-l-4 border-accent bg-surface-alt/40 px-4 py-3 text-sm text-ink">
              {row.grader.explanation}
            </blockquote>
          )}
        </div>
      ) : row.grader_error ? (
        <pre className="mt-3 rounded-r-lg border-l-4 border-cat-deadline bg-cat-deadline/8 px-3 py-2 text-xs text-mono text-cat-deadline whitespace-pre-wrap break-words">
          grader failed: {row.grader_error}
        </pre>
      ) : null}
    </div>
  );
}

export function CaseDetail({
  caseId,
  rows,
}: {
  caseId: string;
  rows: EvalRow[];
}) {
  const isVision = rows.some((r) => r.input_type === "image");
  return (
    <details className="group mt-4 overflow-hidden rounded-xl border border-hairline bg-background open:bg-surface">
      <summary className="flex cursor-pointer items-center gap-4 px-5 py-3.5 list-none [&::-webkit-details-marker]:hidden">
        <span className="text-mono font-semibold">{caseId}</span>
        {isVision && (
          <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] bg-warm-surface text-warm">
            Vision
          </span>
        )}
        <span className="text-meta">{rows.length} contender(s)</span>
        <span className="ml-auto text-mono text-ink-mute group-open:hidden">
          +
        </span>
        <span className="ml-auto text-mono text-ink-mute hidden group-open:inline">
          −
        </span>
      </summary>
      <div className="px-5 pb-5">
        {isVision && (
          <div className="mb-4 pt-2">
            <div className="text-eyebrow mb-2">Input image</div>
            <GoldenImage caseId={caseId} />
          </div>
        )}
        {rows.map((r) => (
          <Contender key={`${r.provider}/${r.model}`} row={r} />
        ))}
      </div>
    </details>
  );
}
