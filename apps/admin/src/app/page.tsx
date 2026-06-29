"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@repo/ui/components/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { createClient } from "@/lib/supabase/client";
import {
  ApiError,
  NotAuthenticated,
  adminGet,
  type ExtractionReadout,
} from "@/lib/api";

const outcomesConfig = {
  shown: { label: "Shown", color: "hsl(var(--chart-3))" },
  accepted: { label: "Accepted", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const fieldEditsConfig = {
  control_pct: { label: "control", color: "hsl(var(--chart-1))" },
  treatment_pct: { label: "treatment", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

type State =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExtractionReadout };

/** One grouped (side-by-side) bar card. Each key in `config` becomes a bar
 *  series; recharts handles the gridlines, axis, tooltip and legend so there's
 *  no hand-rolled chart geometry to maintain. */
function GroupedBarCard({
  title,
  description,
  data,
  xKey,
  config,
  suffix = "",
}: {
  title: string;
  description: string;
  data: Record<string, unknown>[];
  xKey: string;
  config: ChartConfig;
  suffix?: string;
}) {
  const keys = Object.keys(config);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ChartContainer config={config} className="h-[280px] w-full">
            <BarChart data={data} margin={{ top: 24 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => `${v}${suffix}`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {keys.map((key) => (
                <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={4}>
                  <LabelList
                    position="top"
                    fontSize={11}
                    className="fill-foreground"
                    formatter={(value) => (value == null ? "" : `${value}${suffix}`)}
                  />
                </Bar>
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adminGet<ExtractionReadout>(
          "/api/admin/experiments/extraction",
        );
        if (!cancelled) setState({ status: "ready", data });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof NotAuthenticated) {
          router.replace("/login");
        } else if (e instanceof ApiError && e.status === 403) {
          setState({ status: "forbidden" });
        } else {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Failed to load",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  if (state.status === "loading") {
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl items-center justify-center px-5">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (state.status === "forbidden") {
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center gap-2 px-5 text-center">
        <h1 className="text-xl font-semibold">Not authorised</h1>
        <p className="text-sm text-muted-foreground">
          This account isn’t an admin.
        </p>
        <Button variant="link" onClick={signOut}>
          Sign out
        </Button>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center gap-2 px-5 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-destructive">{state.message}</p>
      </main>
    );
  }

  const { outcomes, field_edits } = state.data;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Extraction A/B — live charts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          control = OpenAI stack · treatment = Groq / Llama-4 Scout ·{" "}
          <Button
            variant="link"
            onClick={signOut}
            className="h-auto p-0 align-baseline text-sm"
          >
            sign out
          </Button>
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <GroupedBarCard
          title="Shown vs accepted, per model"
          description="How many drafts each arm showed vs how many the user kept. The gap is drop-off; (unassigned) is a health check, not an arm."
          data={outcomes as unknown as Record<string, unknown>[]}
          xKey="model"
          config={outcomesConfig}
        />

        <GroupedBarCard
          title="Field edit rate, per model"
          description="Of the drafts each arm got accepted, what % needed this field fixed? (No start_date field — the date lives in start_time.)"
          data={field_edits as unknown as Record<string, unknown>[]}
          xKey="field"
          config={fieldEditsConfig}
          suffix="%"
        />

        {(outcomes.length === 0 || field_edits.length === 0) && (
          <p className="text-sm text-muted-foreground">
            No data yet — the experiment must be enabled (the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
              experiments
            </code>{" "}
            row) and events captured before charts populate.
          </p>
        )}

        <div className="rounded-lg border border-warm/40 bg-warm/5 px-4 py-3 text-sm text-muted-foreground">
          <b className="text-foreground">Read direction, not significance.</b> Low
          N — several bars can be 1–3 events. These show <i>where</i> to look, not
          a verdict.
        </div>
      </div>
    </main>
  );
}
