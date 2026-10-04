import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlaskConical } from "lucide-react";
import { CrossFade, FadeIn } from "@/lib/page-motion";
import { ErrorState, NoDataState } from "@/components/ui/states";

export default function Studies() {
  const { t } = useTranslation();
  const studies = useQuery({
    queryKey: ["studies"],
    queryFn: async () => {
      const r = await fetch("/api/studies", { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = await r.json();
      return (d.studies || d || []) as Array<{
        id: number;
        code?: string;
        title?: string;
        irbNumber?: string;
        piName?: string;
        status?: string;
      }>;
    },
    retry: false,
  });

  const rows = studies.data ?? [];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <FlaskConical className="h-7 w-7 text-primary" aria-hidden />{" "}
              {t("features.studies.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("features.studies.desc")}</p>
          </div>
        </FadeIn>
        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("studies.researchStudies")}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* isError-first: this used to render an infinite spinner on a
                  failed fetch, so a broken endpoint looked like a slow network. */}
              {studies.isError ? (
                <ErrorState
                  title={t("common.errorTitle")}
                  description={(studies.error as Error).message}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void studies.refetch()}>
                      {t("common.retry")}
                    </Button>
                  }
                />
              ) : (
                <CrossFade
                  loading={studies.isLoading}
                  label={t("common.loading")}
                  skeleton={<div className="h-32 w-full animate-pulse bg-muted/40 rounded-md" />}
                >
                  {rows.length === 0 ? (
                    <NoDataState title={t("studies.none")} size="sm" />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("studies.colId")}</TableHead>
                            <TableHead>{t("studies.colCode")}</TableHead>
                            <TableHead>{t("studies.colTitle")}</TableHead>
                            <TableHead>{t("studies.colIrb")}</TableHead>
                            <TableHead>{t("studies.colPi")}</TableHead>
                            <TableHead>{t("studies.colStatus")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell>{s.id}</TableCell>
                              <TableCell>{s.code}</TableCell>
                              <TableCell>{s.title}</TableCell>
                              <TableCell>{s.irbNumber || t("common.emDash")}</TableCell>
                              <TableCell>{s.piName || t("common.emDash")}</TableCell>
                              <TableCell>{s.status || t("common.emDash")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CrossFade>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </Layout>
  );
}
