import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLiveAnnouncer } from "@/components/live-region";
import { useToast } from "@/hooks/use-toast";
import { ErrorState, NoResultsState } from "@/components/ui/states";
import { PATIENTS_DEFINITION_NAME, recordsApi } from "@/lib/records";
import { useSaveView, useSavedViews, useDeleteView, describeView } from "@/lib/saved-views";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { EmptySavedViews } from "@/components/empty-saved-views";

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { error?: string })?.error || "Failed");
  }
  return r.json() as Promise<T>;
}

interface SearchHit {
  id: number;
  definitionId: number;
  data: Record<string, unknown>;
  createdAt: string;
}

const PREVIEW_FIELDS = 3;

export default function SearchPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { announce } = useLiveAnnouncer();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewToDelete, setViewToDelete] = useState<{ id: number; name: string } | null>(null);

  // Resolve definitionId -> a human-readable collection name from the same
  // cache the rest of the app uses, instead of printing a raw row id.
  const { data: collections } = useQuery({
    queryKey: ["collections-list"],
    queryFn: () => recordsApi.listDefinitions(),
    staleTime: 60_000,
  });
  const defName = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of collections?.definitions ?? []) map.set(d.id, d.name);
    return map;
  }, [collections]);
  const patientsDefId = useMemo(
    () => (collections?.definitions ?? []).find((d) => d.name === PATIENTS_DEFINITION_NAME)?.id,
    [collections],
  );

  // Saved views now use the shared shape/module (search used to persist
  // `{ note: q }`, which no other page could read).
  const views = useSavedViews(patientsDefId ?? 0);
  const saveView = useSaveView(patientsDefId);
  const deleteView = useDeleteView(patientsDefId ?? 0);

  const search = useMutation({
    mutationFn: () => postJson<{ results?: SearchHit[] }>("/api/search", { q: q || undefined }),
    onSuccess: (d) => {
      const next = d.results ?? [];
      setResults(next);
      setHasSearched(true);
      announce(t("a11y.resultsAnnounced", { count: next.length }));
    },
    onError: (e) => {
      toast({
        title: t("search.loadFailed"),
        description: (e as Error).message,
        variant: "destructive",
      });
    },
  });

  function applyView(v: { q?: string }) {
    setQ(v.q ?? "");
    if (v.q) search.mutate();
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Search className="h-7 w-7 text-primary" /> {t("features.search.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.search.desc")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("search.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                search.mutate();
              }}
            >
              <FormRow label={t("search.placeholder")} className="min-w-[240px] flex-1" controlClassName="mt-0">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("search.placeholder")}
                />
              </FormRow>
              <Button type="submit" disabled={search.isPending}>
                {search.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                {search.isPending ? t("search.searching") : t("search.runSearch")}
              </Button>
            </form>
            {search.isError && (
              <ErrorState
                title={t("common.errorTitle")}
                description={t("search.loadFailed")}
                action={<Button onClick={() => search.mutate()}>{t("common.retry")}</Button>}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base" role="status" aria-live="polite">
              {t("search.results", { count: results.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasSearched && results.length === 0 && !search.isError ? (
              <NoResultsState title={t("search.noResults")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <caption className="sr-only">{t("search.title")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("common.patientId")}</TableHead>
                      <TableHead>{t("search.definition")}</TableHead>
                      <TableHead>{t("search.preview")}</TableHead>
                      <TableHead>{t("search.created")}</TableHead>
                      <TableHead className="text-end">{t("admin.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => {
                      const isPatient = r.definitionId === patientsDefId;
                      const href = isPatient
                        ? `/patients/${r.id}`
                        : `/records/${r.definitionId}/${r.id}`;
                      return (
                        <TableRow key={`${r.definitionId}-${r.id}`}>
                          <TableCell className="font-medium">
                            {String(
                              (r.data?.patientId as string) ??
                                (r.data?.id as string) ??
                                r.id,
                            )}
                          </TableCell>
                          <TableCell>
                            {defName.get(r.definitionId) ?? t("search.unknownDefinition")}
                          </TableCell>
                          {/* Definition-aware preview instead of JSON.stringify */}
                          <TableCell>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                              {Object.entries(r.data ?? {})
                                .slice(0, PREVIEW_FIELDS)
                                .map(([k, v]) => (
                                  <div key={k} className="contents">
                                    <dt className="text-muted-foreground capitalize">{k}</dt>
                                    <dd className="truncate max-w-[16rem]">
                                      {Array.isArray(v) ? v.join(", ") : String(v ?? "—")}
                                    </dd>
                                  </div>
                                ))}
                            </dl>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell className="text-end">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={href}>{t("search.viewRecord")}</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("savedViews.menu")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!viewName.trim()) return;
                saveView.mutate(
                  { name: viewName.trim(), q },
                  {
                    onSuccess: () => setViewName(""),
                    onError: (err) =>
                      toast({
                        title: t("savedViews.saveFailed"),
                        description: (err as Error).message,
                        variant: "destructive",
                      }),
                  },
                );
              }}
            >
              <FormRow label={t("savedViews.name")} controlClassName="mt-0">
                <Input
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  placeholder={t("savedViews.namePlaceholder")}
                />
              </FormRow>
              <Button type="submit" variant="secondary" disabled={!viewName.trim() || saveView.isPending}>
                {t("savedViews.save")}
              </Button>
            </form>

            {views.isError ? (
              <ErrorState
                title={t("common.errorTitle")}
                description={t("savedViews.loadFailed")}
                action={<Button onClick={() => void qc.invalidateQueries({ queryKey: ["saved-views"] })}>{t("common.retry")}</Button>}
              />
            ) : views.data?.views.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <caption className="sr-only">{t("savedViews.menu")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("savedViews.name")}</TableHead>
                      <TableHead>{t("search.definition")}</TableHead>
                      <TableHead className="text-end">{t("admin.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {views.data.views.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {describeView(v, t) || "—"}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => applyView(v)}
                            >
                              {t("savedViews.apply")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              aria-label={`${t("savedViews.delete")}: ${v.name}`}
                              onClick={() => setViewToDelete({ id: v.id, name: v.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptySavedViews />
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDestructive
        open={viewToDelete !== null}
        onOpenChange={(v) => {
          if (!v) setViewToDelete(null);
        }}
        title={t("savedViews.deleteTitle")}
        description={t("savedViews.deleteBody", { name: viewToDelete?.name ?? "" })}
        confirmLabel={t("savedViews.delete")}
        onConfirm={async () => {
          if (!viewToDelete) return;
          await deleteView.mutateAsync(viewToDelete.id);
          setViewToDelete(null);
        }}
      />
    </Layout>
  );
}