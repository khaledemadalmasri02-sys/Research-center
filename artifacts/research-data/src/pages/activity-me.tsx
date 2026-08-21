import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";
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

export default function ActivityMe() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<{ events: AuditEvent[]; total: number }>({
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
          <p className="text-muted-foreground mt-1">Your recent account activity.</p>
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
            ) : data && data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("activity.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
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
