"use client";

import {
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import useSWR from "swr";
import { useQueryState } from "nuqs";
import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingContent } from "@/components/LoadingContent";
import type { UsageReport } from "@/utils/openrouter-usage";

// Recharts 2 class components use a different React type identity in this workspace.
type AxisProps = {
  type?: "number" | "category";
  dataKey?: string;
  width?: number;
  stroke?: string;
  fontSize?: number;
  allowDecimals?: boolean;
  tickFormatter?: (value: string) => string;
};
const ChartXAxis = XAxis as unknown as ComponentType<AxisProps>;
const ChartYAxis = YAxis as unknown as ComponentType<AxisProps>;
const ChartBar = Bar as unknown as ComponentType<{
  dataKey: string;
  name: string;
  fill: string;
  radius?: [number, number, number, number];
  children?: ReactNode;
  isAnimationActive?: boolean;
}>;
const ChartTooltip = Tooltip as unknown as ComponentType<{
  contentStyle: CSSProperties;
  cursor: { fill: string };
}>;

const tooltipStyle = {
  backgroundColor: "hsl(var(--background))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const colors = [
  "#60a5fa",
  "#c084fc",
  "#fbbf24",
  "#f87171",
  "#34d399",
  "#fb923c",
  "#a5b4fc",
  "#94a3b8",
];
async function read(url: string): Promise<UsageReport> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load usage.");
  return data;
}

export function UsageDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useQueryState("date", { defaultValue: today });
  const [view, setView] = useState<"requests" | "history">("requests");
  const selected =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      ? date
      : today;
  const { data, error, isValidating, mutate } = useSWR(
    `/api/user/usage?date=${selected}`,
    read,
    { refreshInterval: 15_000 },
  );
  const changeDay = (delta: number) =>
    setDate(
      new Date(Date.parse(`${selected}T00:00:00Z`) + delta * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  const features = new Map<
    string,
    {
      feature: string;
      calls: number;
      failed: number;
      items: number;
      blocked: number;
    }
  >();
  for (const group of data?.groups ?? []) {
    const row = features.get(group.feature) ?? {
      feature: group.feature,
      calls: 0,
      failed: 0,
      items: 0,
      blocked: 0,
    };
    if (group.counted) {
      row.calls += group.calls;
      row.items += group.items ?? 0;
      if (group.outcome === "failed") row.failed += group.calls;
    } else row.blocked += group.calls;
    features.set(group.feature, row);
  }
  if (data?.legacyBackfill)
    features.set("Old email tagging · historical", {
      feature: "Old email tagging · historical",
      calls: data.legacyBackfill,
      failed: 0,
      items: 0,
      blocked: 0,
    });
  if (data?.legacyUnattributed)
    features.set("Unattributed · historical / upstream", {
      feature: "Unattributed · historical / upstream",
      calls: data.legacyUnattributed,
      failed: 0,
      items: 0,
      blocked: 0,
    });
  const breakdown = [...features.values()].sort((a, b) => b.calls - a.calls);
  const failed =
    data?.groups
      .filter((g) => g.counted && g.outcome === "failed")
      .reduce((n, g) => n + g.calls, 0) ?? 0;
  const blocked =
    data?.groups.filter((g) => !g.counted).reduce((n, g) => n + g.calls, 0) ??
    0;
  const days = [...(data?.history ?? [])]
    .filter((d) => d.day <= selected)
    .slice(0, 30)
    .reverse();
  return (
    <PageWrapper>
      <div className="space-y-6 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Usage</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              OpenRouter calls across all accounts. Days reset at 00:00 UTC.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous day"
              onClick={() => changeDay(-1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <input
              type="date"
              aria-label="Usage date (UTC)"
              value={selected}
              max={today}
              onChange={(event) => {
                if (event.target.value && event.target.value <= today)
                  setDate(event.target.value);
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm [color-scheme:dark]"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Next day"
              disabled={selected >= today}
              onClick={() => changeDay(1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh usage"
              disabled={isValidating}
              onClick={() => mutate()}
            >
              <RefreshCwIcon
                className={`size-4 ${isValidating ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
        <LoadingContent
          loading={!data && !error}
          error={error ? { error: error.message } : undefined}
        >
          {data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ["Counted calls", data.total.toLocaleString()],
                  [
                    "Daily allowance",
                    `${data.limits.perDay.toLocaleString()} · ${data.limits.perMinute}/min`,
                  ],
                  ["Failed upstream attempts", failed.toLocaleString()],
                  ["Blocked locally · no API call", blocked.toLocaleString()],
                ].map(([title, value]) => (
                  <Card key={title}>
                    <CardHeader className="p-4 pb-2">
                      <CardDescription>{title}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-xl font-semibold">
                      {value}
                    </CardContent>
                  </Card>
                ))}
              </div>
              {data.legacy > 0 && (
                <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  {data.legacy.toLocaleString()} calls on this day predate
                  detailed tracking or were imported from OpenRouter’s usage
                  counter. Existing old-email totals are preserved; the
                  remaining feature and outcome details were never recorded.
                </p>
              )}
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Calls by feature
                    </CardTitle>
                    <CardDescription>
                      Actual attempts sent upstream, including failures. Local
                      blocks are excluded.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      role="img"
                      aria-label="Calls by feature graph"
                      style={{ height: Math.max(200, breakdown.length * 38) }}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={breakdown}
                          layout="vertical"
                          margin={{ left: 0, right: 20 }}
                        >
                          <CartesianGrid
                            stroke="hsl(var(--border))"
                            horizontal={false}
                          />
                          <ChartXAxis
                            type="number"
                            allowDecimals={false}
                            stroke="#94a3b8"
                            fontSize={11}
                          />
                          <ChartYAxis
                            type="category"
                            dataKey="feature"
                            width={170}
                            stroke="#94a3b8"
                            fontSize={11}
                          />
                          <ChartTooltip
                            contentStyle={tooltipStyle}
                            cursor={{ fill: "hsl(var(--muted))" }}
                          />
                          <ChartBar
                            dataKey="calls"
                            name="Counted calls"
                            fill="#60a5fa"
                            radius={[0, 3, 3, 0]}
                          >
                            {breakdown.map((row, index) => (
                              <Cell
                                key={row.feature}
                                fill={colors[index % colors.length]}
                              />
                            ))}
                          </ChartBar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 space-y-2">
                      {breakdown.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No calls on this date.
                        </p>
                      ) : (
                        breakdown.map((row, index) => (
                          <div
                            key={row.feature}
                            className="flex justify-between gap-3 text-sm"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  background: colors[index % colors.length],
                                }}
                              />
                              {row.feature}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {row.calls} calls
                              {row.failed ? ` · ${row.failed} failed` : ""}
                              {row.items
                                ? ` · ${row.items} items submitted`
                                : ""}
                              {row.blocked ? ` · ${row.blocked} blocked` : ""}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Calls throughout the day
                    </CardTitle>
                    <CardDescription>
                      UTC hours. Historical calls without timestamps are
                      excluded.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      role="img"
                      aria-label="Hourly calls graph"
                      className="h-64"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.hourly}>
                          <CartesianGrid
                            stroke="hsl(var(--border))"
                            vertical={false}
                          />
                          <ChartXAxis
                            dataKey="hour"
                            stroke="#94a3b8"
                            fontSize={11}
                          />
                          <ChartYAxis
                            allowDecimals={false}
                            stroke="#94a3b8"
                            fontSize={11}
                            width={32}
                          />
                          <ChartTooltip
                            contentStyle={tooltipStyle}
                            cursor={{ fill: "hsl(var(--muted))" }}
                          />
                          <ChartBar
                            dataKey="calls"
                            name="Counted calls"
                            fill="#60a5fa"
                          />
                          <ChartBar
                            dataKey="failed"
                            name="Failed (included in calls)"
                            fill="#f87171"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      A call can classify several items. “Items submitted”
                      includes repeat attempts, not unique conversations. A
                      locally blocked retry consumes no OpenRouter call.
                    </p>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Daily call history
                  </CardTitle>
                  <CardDescription>
                    Latest 30 recorded days up to the selected date. Full
                    history is retained below.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    role="img"
                    aria-label="Daily calls graph"
                    className="h-52"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={days}>
                        <CartesianGrid
                          stroke="hsl(var(--border))"
                          vertical={false}
                        />
                        <ChartXAxis
                          dataKey="day"
                          tickFormatter={(day) => day.slice(5)}
                          stroke="#94a3b8"
                          fontSize={11}
                        />
                        <ChartYAxis
                          allowDecimals={false}
                          stroke="#94a3b8"
                          fontSize={11}
                          width={40}
                        />
                        <ChartTooltip
                          contentStyle={tooltipStyle}
                          cursor={{ fill: "hsl(var(--muted))" }}
                        />
                        <ChartBar
                          dataKey="calls"
                          name="Counted calls"
                          fill="#a78bfa"
                          radius={[3, 3, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={view === "requests" ? "secondary" : "ghost"}
                  onClick={() => setView("requests")}
                >
                  Request log
                </Button>
                <Button
                  size="sm"
                  variant={view === "history" ? "secondary" : "ghost"}
                  onClick={() => setView("history")}
                >
                  All dates
                </Button>
              </div>
              <Card>
                {view === "history" ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>UTC date</TableHead>
                        <TableHead>Counted calls</TableHead>
                        <TableHead>Detailed records</TableHead>
                        <TableHead>Failed</TableHead>
                        <TableHead>Blocked locally</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.history.map((row) => (
                        <TableRow key={row.day}>
                          <TableCell>
                            <button
                              type="button"
                              className="text-blue-400 hover:underline"
                              onClick={() => setDate(row.day)}
                            >
                              {row.day}
                            </button>
                          </TableCell>
                          <TableCell>{row.calls}</TableCell>
                          <TableCell>{row.tracked}</TableCell>
                          <TableCell>{row.failed}</TableCell>
                          <TableCell>{row.blocked}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <>
                    <CardHeader>
                      <CardDescription>
                        Latest 100 attempts for {selected}. All detailed records
                        remain stored across restarts.
                      </CardDescription>
                    </CardHeader>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time (UTC)</TableHead>
                          <TableHead>Feature</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead>Items</TableHead>
                          <TableHead>Outcome</TableHead>
                          <TableHead>Counted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recent.map((row, index) => (
                          <TableRow key={`${row.at}-${index}`}>
                            <TableCell className="whitespace-nowrap">
                              {new Date(row.at).toISOString().slice(11, 19)}
                            </TableCell>
                            <TableCell>{row.feature}</TableCell>
                            <TableCell
                              className="max-w-64 truncate"
                              title={row.model}
                            >
                              {row.model}
                            </TableCell>
                            <TableCell>{row.items ?? "—"}</TableCell>
                            <TableCell>
                              {row.outcome}
                              {row.status ? ` · ${row.status}` : ""}
                            </TableCell>
                            <TableCell>{row.counted ? "Yes" : "No"}</TableCell>
                          </TableRow>
                        ))}
                        {!data.recent.length && (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="py-6 text-center text-muted-foreground"
                            >
                              No detailed request records on this date.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </>
                )}
              </Card>
            </>
          )}
        </LoadingContent>
      </div>
    </PageWrapper>
  );
}
