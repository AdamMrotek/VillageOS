/**
 * Grouped (side-by-side) bar chart — a React port of the renderer in the old
 * apps/api/scripts/build_experiment_charts.py, kept so the dashboard never
 * depends on a charting lib or PostHog's UI. One category per group, one bar per
 * series, value labels on top, a few gridline rungs.
 */

export type Series = {
  label: string;
  color: string;
  values: (number | null)[]; // aligned to `categories`
};

/** Smallest multiple of 10 at or above the data's peak (min 10), for the axis. */
function niceMax(values: (number | null)[]): number {
  const peak = Math.max(0, ...values.filter((v): v is number => v != null));
  return Math.max(10, Math.ceil(peak / 10) * 10);
}

export default function BarChart({
  title,
  subtitle,
  categories,
  series,
  suffix = "",
}: {
  title: string;
  subtitle: string;
  categories: string[];
  series: Series[];
  suffix?: string;
}) {
  const axis = niceMax(series.flatMap((s) => s.values));
  const rungs = Array.from({ length: 6 }, (_, i) => Math.round((axis * (5 - i)) / 5));

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="q">{subtitle}</p>
      <div className="legend">
        {series.map((s) => (
          <span className="lg" key={s.label}>
            <span className="sw" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart">
        <div className="plot">
          <div className="grid">
            {rungs.map((r) => (
              <div className="gl" key={r} style={{ bottom: `${(r / axis) * 100}%` }}>
                <b>
                  {r}
                  {suffix}
                </b>
              </div>
            ))}
          </div>
          <div className="groups">
            {categories.map((_, i) => (
              <div className="grp" key={i}>
                <div className="bars">
                  {series.map((s) => {
                    const v = s.values[i] ?? 0;
                    const label = `${v}${suffix}`;
                    return (
                      <div
                        key={s.label}
                        className={`bar${v === 0 ? " zero" : ""}`}
                        style={{ height: `${(v / axis) * 100}%`, background: s.color }}
                        title={label}
                      >
                        <span className="v">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="xrow">
          {categories.map((c) => (
            <div className="xc" key={c}>
              <div className={`xl${c.startsWith("(") ? " muted" : ""}`}>{c}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
