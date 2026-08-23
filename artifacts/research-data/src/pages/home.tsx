import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Stagger, StaggerItem, FadeIn } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  recordsApi,
  useCollectionsStats,
  type RecordDefinition,
  type CollectionOverview,
  type FieldStat,
} from "@/lib/records";
import { Users, Clock, Layers, ChevronDown, Check, Database, BarChart3 } from "lucide-react";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

export default function Home() {
  const [selected, setSelected] = useState<number[]>([]);

  const { data: defsRes, isLoading: defsLoading } = useQuery({
    queryKey: ["record-definitions"],
    queryFn: () => recordsApi.listDefinitions(),
  });
  const definitions: RecordDefinition[] = defsRes?.definitions ?? [];

  const { data: stats, isLoading: statsLoading } = useCollectionsStats(
    selected.length > 0 ? selected : undefined,
  );

  const selectableDefs = useMemo(
    () => definitions.filter((d) => !d.deactivated),
    [definitions],
  );
  const defMap = useMemo(
    () => new Map<number, RecordDefinition>(definitions.map((d) => [d.id, d])),
    [definitions],
  );

  const overview: CollectionOverview[] = stats?.overview ?? [];
  const summary = stats?.summary;
  const perCollection = stats?.perCollection ?? [];
  const fieldStats: FieldStat[] = stats?.fieldStats ?? [];

  const isLoading = defsLoading || statsLoading;

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function overviewCard(o: CollectionOverview) {
    return (
      <StaggerItem lift>
      <Card key={o.id} className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base truncate">{o.name}</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
          <div className="flex flex-wrap gap-1">
            {o.isDefault && <Badge variant="secondary">Default</Badge>}
            {o.isActive && <Badge className="bg-emerald-600">In directory</Badge>}
            {o.shared && <Badge variant="outline">Shared</Badge>}
            {o.deactivated && <Badge variant="destructive">Hidden</Badge>}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3">
          <div className="flex items-end gap-4">
            <div>
              <div className="text-2xl font-bold">{o.recordCount}</div>
              <p className="text-xs text-muted-foreground">records</p>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">{o.recentCount}</div>
              <p className="text-xs text-muted-foreground">last 30 days</p>
            </div>
          </div>
          <div className="flex gap-2 mt-auto">
            <Button asChild size="sm" variant="outline" className="flex-1">
              <Link href={`/records/${o.id}`}>View</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="flex-1">
              <Link href={`/collections/${o.id}/edit`}>Edit</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      </StaggerItem>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        <FadeIn>
          <h1 className="text-3xl font-bold tracking-tight">Clinical Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of clinical research data collection across all datasets.
          </p>
        </FadeIn>

        {/* Collection selector */}
        <FadeIn delay={0.08}>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span>Collections:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 justify-between gap-2 min-w-[220px]">
                  <span className="truncate">
                    {selected.length === 0
                      ? "Default collection"
                      : `${selected.length} selected`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2">
                <div className="max-h-72 overflow-auto space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        selected.length === 0
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {selected.length === 0 && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 text-left truncate">Default collection</span>
                  </button>
                  {selectableDefs.length === 0 && (
                    <p className="text-sm text-muted-foreground px-2 py-1">No collections available.</p>
                  )}
                  {selectableDefs.map((c) => {
                    const checked = selected.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggle(c.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border",
                            checked
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-input",
                          )}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1 text-left truncate">{c.name}</span>
                        {c.isDefault && (
                          <span className="text-[10px] uppercase text-emerald-600">default</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear selection
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {summary && (
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-medium text-foreground">{summary.collectionCount}</span>{" "}
              collection{summary.collectionCount > 1 ? "s" : ""}
            </p>
          )}
        </FadeIn>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4 rounded-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {/* Selected collections summary */}
            <Stagger className="grid gap-4 md:grid-cols-3">
              <StaggerItem lift>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Records</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary?.total ?? 0}</div>
                  <p className="text-xs text-muted-foreground">
                    across {summary?.collectionCount ?? 0} collection
                    {(summary?.collectionCount ?? 0) > 1 ? "s" : ""}
                  </p>
                </CardContent>
              </Card>
              </StaggerItem>
              <StaggerItem lift>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Recent Records</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary?.recentCount ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Added in the last 30 days</p>
                </CardContent>
              </Card>
              </StaggerItem>
              <StaggerItem lift>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Collections</CardTitle>
                  <Layers className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{overview.filter((o) => !o.deactivated).length}</div>
                  <p className="text-xs text-muted-foreground">
                    of {overview.length} total
                  </p>
                </CardContent>
              </Card>
              </StaggerItem>
            </Stagger>

            {/* Per-collection breakdown */}
            {perCollection.length > 1 && (
              <FadeIn>
              <Card>
                <CardHeader>
                  <CardTitle>Records per Collection</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={perCollection} layout="vertical" margin={{ left: 20, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          width={140}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                        />
                        <RechartsTooltip
                          cursor={{ fill: "hsl(var(--secondary))" }}
                          contentStyle={{
                            backgroundColor: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                          }}
                        />
                        <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              </FadeIn>
            )}

            {/* Field-level breakdowns (generic — works for any collection) */}
            {fieldStats.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold tracking-tight mb-3 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                Field Insights
                </h2>
                <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {fieldStats.map((f) =>
                    f.type === "number" && f.numeric ? (
                      <StaggerItem lift key={f.key}>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium">{f.label}</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-lg font-bold">{f.numeric.avg}</div>
                            <p className="text-xs text-muted-foreground">average</p>
                          </div>
                          <div>
                            <div className="text-lg font-bold">{f.numeric.count}</div>
                            <p className="text-xs text-muted-foreground">values</p>
                          </div>
                          <div>
                            <div className="text-sm font-medium">{f.numeric.min}</div>
                            <p className="text-xs text-muted-foreground">min</p>
                          </div>
                          <div>
                            <div className="text-sm font-medium">{f.numeric.max}</div>
                            <p className="text-xs text-muted-foreground">max</p>
                          </div>
                        </CardContent>
                      </Card>
                      </StaggerItem>
                    ) : (
                      <StaggerItem lift key={f.key}>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium">{f.label}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="h-[220px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={f.values} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis
                                  dataKey="value"
                                  stroke="hsl(var(--muted-foreground))"
                                  fontSize={11}
                                  tickLine={false}
                                  axisLine={false}
                                  interval={0}
                                  angle={f.values!.length > 5 ? -30 : 0}
                                  textAnchor={f.values!.length > 5 ? "end" : "middle"}
                                  height={f.values!.length > 5 ? 50 : 20}
                                />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                                <RechartsTooltip
                                  cursor={{ fill: "hsl(var(--secondary))" }}
                                  contentStyle={{
                                    backgroundColor: "hsl(var(--popover))",
                                    border: "1px solid hsl(var(--border))",
                                    borderRadius: "var(--radius)",
                                  }}
                                />
                                <Bar
                                  dataKey="count"
                                  fill={COLORS[0]}
                                  radius={[4, 4, 0, 0]}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                      </StaggerItem>
                    ),
                  )}
                </Stagger>
              </div>
            )}

            {/* All collections overview grid */}
            <div>
              <h2 className="text-xl font-semibold tracking-tight mb-3 flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              All Collections
              </h2>
              {overview.length === 0 ? (
              <Card>
              <CardContent className="text-sm text-muted-foreground py-8 text-center">
              No collections found. Create one from the{" "}
              <Link href="/collections" className="underline text-primary">
              Data Collections
              </Link>{" "}
              page.
              </CardContent>
              </Card>
              ) : (
              <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {overview.map(overviewCard)}
              </Stagger>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
