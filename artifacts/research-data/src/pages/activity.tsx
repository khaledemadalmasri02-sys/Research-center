import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

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

export default function Activity() {
  const { canAdminAccess } = useAuth();
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [actionFilter, setActionFilter] = useState("");

  if (!canAdminAccess) {
    navigate("/");
    return null;
  }

  const { data, isLoading } = useAudit(actionFilter);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" /> {t("activity.global")}
          </h1>
          <p className="text-muted-foreground mt-1">Global audit trail across the platform.</p>
        </div>

        <div className="max-w-sm">
          <Input
            placeholder="Filter by action (e.g. auth.login)"
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{e.action}</Badge>
                        </TableCell>
                        <TableCell>{e.userId ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {e.entity ?? "—"}
                          {e.entityId != null ? ` #${e.entityId}` : ""}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.ip ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
