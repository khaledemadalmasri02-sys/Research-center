import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DesktopLink } from "@/components/desktop/DesktopLink";
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
import { NoDataState, ErrorState } from "@/components/ui/states";
import {
  CrossFade,
  FadeIn,
  StaggeredItem,
  StaggeredList,
  useChartAnimation,
} from "@/lib/page-motion";
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
  const { t } = useTranslation();
  const chart = useChartAnimation();
  const [selected, setSelected] = useState<number[]>([]);

  const {
    data: defsRes,
    isLoading: defsLoading,
    isError: defsError,
    refetch: refetchDefs,
  } = useQuery({
    queryKey: ["record-definitions"],
    queryFn: () => recordsApi.listDefinitions(),
  });
  const definitions: RecordDefinition[] = defsRes?.definitions ?? [];

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useCollectionsStats(selected.length > 0 ? selected : undefined);

  const selectableDefs = useMemo(
    () => definitions.filter((d) => !d.deactivated),
    [definitions],
  );

  const overview: CollectionOverview[] = stats?.overview ?? [];
  const summary = stats?.summary;
  const perCollection = stats?.perCollection ?? [];
  const fieldStats: FieldStat[] = stats?.fieldStats ?? [];

  const isLoading = defsLoading || statsLoading;
  const isError = defsError || statsError;

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function overviewCard(o: CollectionOverview, index: number) {
    return (
      <StaggeredItem key={o.id} index={index}>
        <Card className="flex flex-col h-full card-interactive">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base truncate">{o.name}</CardTitle>
              <Layers className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            </div>
            <div className="flex flex-wrap gap-1">
              {o.isDefault && <Badge variant="secondary">{t("home.badgeDefault")}</Badge>}
              {o.isActive && (
                <Badge className="bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950">
                  {t("home.badgeInDirectory")}
                </Badge>
              )}
              {o.shared && <Badge variant="outline">{t("home.badgeShared")}</Badge>}
              {o.deactivated && <Badge variant="destructive">{t("home.badgeHidden")}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3">
            <div className="flex items-end gap-4">
              <div>
                <div className="text-2xl font-bold tabular-nums">{o.recordCount}</div>
                <p className="text-xs text-muted-foreground">{t("home.recordsLabel")}</p>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground tabular-nums">
                  {o.recentCount}
                </div>
                <p className="text-xs text-muted-foreground">{t("home.last30Days")}</p>
              </div>
            </div>
            {/* `DesktopLink` renders a real <a href> and routes through the
                desktop window manager; a bare wouter <Link> is a no-op on the
                apex host. */}
            <div className="flex gap-2 mt-auto">
              <Button asChild size="sm" variant="outline" className="flex-1 pressable">
                <DesktopLink href={`/records/${o.id}`} appId="records/:definitionId">
                  {t("common.open")}
                </DesktopLink>
              </Button>
              <Button asChild size="sm" variant="ghost" className="flex-1 pressable">
                <DesktopLink href={`/collections/${o.id}/edit`} appId="collections/:id/edit">
                  {t("common.edit")}
                </DesktopLink>
              </Button>
            </div>
          </CardContent>
        </Card>
      </StaggeredItem>
    );
  }

  const dashboardSkeleton = (
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
  );

  return (
    <Layout>
      <div className="space-y-8">
        <FadeIn>
          <h1 className="text-3xl font-bold tracking-tight">{t("home.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("home.subtitle")}</p>
        </FadeIn>

        {/* Collection selector */}
        <FadeIn delay={0.06}>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" aria-hidden />
            <span id="collection-selector-label">{t("home.collectionsLabel")}</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 justify-between gap-2 min-w-[220px]"
                  aria-labelledby="collection-selector-label"
                >
                  <span className="truncate">
                    {selected.length === 0
                      ? t("home.defaultCollection")
                      : t("common.selectedCount", { count: selected.length })}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2">
                <div className="max-h-72 overflow-auto space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    aria-pressed={selected.length === 0}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        selected.length === 0
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {selected.length === 0 && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 text-start truncate">{t("home.defaultCollection")}</span>
                  </button>
                  {selectableDefs.length === 0 && (
                    <p className="text-sm text-muted-foreground px-2 py-1">
                      {t("home.noCollectionsAvailable")}
                    </p>
                  )}
                  {selectableDefs.map((c) => {
                    const checked = selected.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggle(c.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border",
                            checked
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-input",
                          )}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1 text-start truncate">{c.name}</span>
                        {c.isDefault && (
                          <span className="text-xs uppercase text-emerald-700 dark:text-emerald-400">
                            {t("home.defaultTag")}
                          </span>
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
                    {t("home.clearSelection")}
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {summary && (
            <p className="text-sm text-muted-foreground">
              {t("home.showingCollections", { count: summary.collectionCount })}
            </p>
          )}
        </FadeIn>

        {/* isError-first: a failed stats fetch used to render an empty
            dashboard that looked exactly like "you have no collections". */}
        {isError ? (
          <ErrorState
            title={t("common.errorTitle")}
            description={t("home.loadFailed")}
            action={
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    void refetchDefs();
                    void refetchStats();
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            }
          />
        ) : (
          <CrossFade loading={isLoading} skeleton={dashboardSkeleton}>
            <div className="space-y-8">
              {/* Selected collections summary */}
              <StaggeredList className="grid gap-4 md:grid-cols-3">
                <StaggeredItem index={0}>
                  <Card className="h-full">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">{t("home.totalRecords")}</CardTitle>
                      <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold tabular-nums">{summary?.total ?? 0}</div>
                      <p className="text-xs text-muted-foreground">
                        {t("home.totalRecordsSub", { count: summary?.collectionCount ?? 0 })}
                      </p>
                    </CardContent>
                  </Card>
                </StaggeredItem>
                <StaggeredItem index={1}>
                  <Card className="h-full">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">{t("home.recentRecords")}</CardTitle>
                      <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold tabular-nums">{summary?.recentCount ?? 0}</div>
                      <p className="text-xs text-muted-foreground">{t("home.recentRecordsSub")}</p>
                    </CardContent>
                  </Card>
                </StaggeredItem>
                <StaggeredItem index={2}>
                  <Card className="h-full">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">{t("home.activeCollections")}</CardTitle>
                      <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold tabular-nums">
                        {overview.filter((o) => !o.deactivated).length}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("home.activeCollectionsSub", { count: overview.length })}
                      </p>
                    </CardContent>
                  </Card>
                </StaggeredItem>
              </StaggeredList>

              {/* Per-collection breakdown */}
              {perCollection.length > 0 && (
                <FadeIn>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("home.recordsPerCollection")}</CardTitle>
                    </CardHeader>
                    <CardContent className="ps-2">
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={perCollection}
                            layout="vertical"
                            margin={{ left: 20, right: 16 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              horizontal={false}
                              stroke="hsl(var(--border))"
                            />
                            <XAxis
                              type="number"
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={12}
                              tickLine={false}
                              axisLine={false}
                            />
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
                            <Bar
                              dataKey="total"
                              name={t("home.recordsLabel")}
                              fill="hsl(var(--primary))"
                              radius={[0, 4, 4, 0]}
                              isAnimationActive={chart.isAnimationActive}
                              animationDuration={chart.animationDuration}
                            />
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
                    <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden />
                    {t("home.fieldInsights")}
                  </h2>
                  <StaggeredList className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {fieldStats.map((f, i) =>
                      f.type === "number" && f.numeric ? (
                        <StaggeredItem key={f.key} index={i}>
                          <Card className="h-full">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium">{f.label}</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="text-lg font-bold tabular-nums">{f.numeric.avg}</div>
                                <p className="text-xs text-muted-foreground">{t("home.statAverage")}</p>
                              </div>
                              <div>
                                <div className="text-lg font-bold tabular-nums">
                                  {f.numeric.count}
                                </div>
                                <p className="text-xs text-muted-foreground">{t("home.statValues")}</p>
                              </div>
                              <div>
                                <div className="text-sm font-medium tabular-nums">{f.numeric.min}</div>
                                <p className="text-xs text-muted-foreground">{t("home.statMin")}</p>
                              </div>
                              <div>
                                <div className="text-sm font-medium tabular-nums">{f.numeric.max}</div>
                                <p className="text-xs text-muted-foreground">{t("home.statMax")}</p>
                              </div>
                            </CardContent>
                          </Card>
                        </StaggeredItem>
                      ) : (
                        <StaggeredItem key={f.key} index={i}>
                          <Card className="h-full">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-medium">{f.label}</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="h-[220px]">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart
                                    data={f.values}
                                    margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                                  >
                                    <CartesianGrid
                                      strokeDasharray="3 3"
                                      vertical={false}
                                      stroke="hsl(var(--border))"
                                    />
                                    <XAxis
                                      dataKey="value"
                                      stroke="hsl(var(--muted-foreground))"
                                      fontSize={12}
                                      tickLine={false}
                                      axisLine={false}
                                      interval={0}
                                      angle={f.values!.length > 5 ? -30 : 0}
                                      textAnchor={f.values!.length > 5 ? "end" : "middle"}
                                      height={f.values!.length > 5 ? 50 : 20}
                                    />
                                    <YAxis
                                      stroke="hsl(var(--muted-foreground))"
                                      fontSize={12}
                                      tickLine={false}
                                      axisLine={false}
                                      allowDecimals={false}
                                    />
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
                                      name={t("home.statValues")}
                                      fill={COLORS[0]}
                                      radius={[4, 4, 0, 0]}
                                      isAnimationActive={chart.isAnimationActive}
                                      animationDuration={chart.animationDuration}
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </CardContent>
                          </Card>
                        </StaggeredItem>
                      ),
                    )}
                  </StaggeredList>
                </div>
              )}

              {/* All collections overview grid */}
              <div>
                <h2 className="text-xl font-semibold tracking-tight mb-3 flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
                  {t("home.allCollections")}
                </h2>
                {overview.length === 0 ? (
                  <FadeIn>
                    <NoDataState
                      title={t("home.noCollectionsTitle")}
                      description={
                        <>
                          {t("home.noCollectionsBodyPre")}{" "}
                          <DesktopLink
                            href="/collections"
                            appId="collections"
                            className="underline text-primary"
                          >
                            {t("nav.collections")}
                          </DesktopLink>{" "}
                          {t("home.noCollectionsBodyPost")}
                        </>
                      }
                    />
                  </FadeIn>
                ) : (
                  <StaggeredList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {overview.map(overviewCard)}
                  </StaggeredList>
                )}
              </div>
            </div>
          </CrossFade>
        )}
      </div>
    </Layout>
  );
}
