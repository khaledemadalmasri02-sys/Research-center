import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";

interface AuditEvent {
  id: number;
  userId: number | null;
  action: string;
  entity: string | null;
  entityId: number | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

const columns: ColumnDef<AuditEvent, unknown>[] = [
  {
    accessorKey: "createdAt",
    header: "Time",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {new Date(row.original.createdAt).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => <Badge variant="outline">{row.original.action}</Badge>,
  },
  {
    accessorKey: "ip",
    header: "IP",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.ip ?? "—"}</span>
    ),
  },
];

export default function ActivityMe() {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<{ events: AuditEvent[]; total: number }>({
    queryKey: ["audit-me"],
    queryFn: async () => {
      const res = await fetch(`/api/audit/me`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
  });

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-7 w-7 text-primary" /> {t("activity.personal")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("activity.personal")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{t("common.rowsCount", { count: data?.total ?? 0 })}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8" role="status">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : isError ? (
              /* A failed fetch used to fall through to the "No activity yet"
               * branch, so a 500 read as "you have no activity". */
              <ErrorState
                title={t("common.errorTitle")}
                description={t("activity.loadFailed")}
                action={
                  <Button onClick={() => void refetch()} disabled={isFetching}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : data && data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("activity.empty")}</p>
            ) : (
              <DataTable<AuditEvent>
                data={data?.events ?? []}
                columns={columns}
                getRowId={(row) => String(row.id)}
                storageKey="activity-me"
                searchable={false}
                initialSort={[{ id: "createdAt", desc: true }]}
                emptyState={
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("activity.empty")}
                  </div>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}