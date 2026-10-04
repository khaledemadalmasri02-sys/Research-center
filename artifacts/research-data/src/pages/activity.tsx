import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { NoPermissionState } from "@/components/ui/states";
import { DataTable } from "@/components/ui/data-table";
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

function useAudit(actionFilter: string) {
  return useQuery<{ events: AuditEvent[]; total: number }>({
    queryKey: ["audit-global", actionFilter],
    queryFn: async () => {
      const qs = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : "";
      const res = await fetch(`/api/audit${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load audit log");
      return res.json();
    },
  });
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
    accessorKey: "userId",
    header: "User",
    cell: ({ row }) => row.original.userId ?? "—",
  },
  {
    id: "entity",
    header: "Entity",
    cell: ({ row }) => (
      <span className="text-xs">
        {row.original.entity ?? "—"}
        {row.original.entityId != null ? ` #${row.original.entityId}` : ""}
      </span>
    ),
  },
  {
    accessorKey: "ip",
    header: "IP",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.ip ?? "—"}</span>
    ),
  },
];

export default function Activity() {
  const { canAdminAccess } = useAuth();
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [actionFilter, setActionFilter] = useState("");

  // `navigate()` used to run DURING render — a React violation that
  // StrictMode double-fires and that sets state on an unmounted component.
  useEffect(() => {
    if (!canAdminAccess) navigate("/");
  }, [canAdminAccess, navigate]);

  if (!canAdminAccess) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <NoPermissionState
            title={t("common.noPermissionTitle")}
            description={t("common.noPermissionDesc")}
          />
        </div>
      </Layout>
    );
  }

  const { data, isLoading } = useAudit(actionFilter);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" /> {t("activity.global")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.audit.desc")}</p>
        </div>

        <div className="max-w-sm">
          <Input
            placeholder={t("activity.filterPlaceholder")}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-9"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{data?.total ?? 0} events</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <DataTable<AuditEvent>
                data={data?.events ?? []}
                columns={columns}
                getRowId={(row) => String(row.id)}
                storageKey="activity-global"
                initialSort={[{ id: "createdAt", desc: true }]}
                emptyState={<div className="py-8 text-center text-sm text-muted-foreground">{t("activity.emptyAudit")}</div>}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}