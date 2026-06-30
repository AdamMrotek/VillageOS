import { scoreClass } from "@/lib/evals/results";

const STYLES: Record<string, string> = {
  "score-good": "bg-accent-soft text-accent-dark",
  "score-mid": "bg-warm-surface text-warm",
  "score-bad": "bg-cat-deadline/15 text-cat-deadline",
  "score-na": "bg-surface-alt text-ink-mute",
};

export function Score({
  value,
  suffix = "/10",
}: {
  value: number | null | undefined;
  suffix?: string;
}) {
  const cls = STYLES[scoreClass(value)];
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-mono text-xs font-semibold ${cls}`}
    >
      {value === null || value === undefined ? "—" : `${value.toFixed?.(1) ?? value}${suffix}`}
    </span>
  );
}
