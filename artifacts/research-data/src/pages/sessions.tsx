import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Monitor, Trash2, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SessionRow {
  sid: string;
  username: string | null;
  current: boolean;
  expiresAt: string;
}

export default function Sessions() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["sessions"],
    queryFn: async () => {
      const res = await fetch("/api/sessions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await fetch(`/api/sessions/${sid}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const revokeOthersMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sessions`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Monitor className="h-7 w-7 text-primary" /> {t("sessions.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("sessions.subtitle")}</p>
          </div>
          <Button variant="outline" onClick={() => revokeOthersMutation.mutate()} disabled={revokeOthersMutation.isPending}>
            <LogOut className="h-4 w-4 mr-1" />
            {t("sessions.revokeOthers")}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{data?.sessions.length ?? 0} sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-2">
                {data?.sessions.map((s) => (
                  <div key={s.sid} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                        {s.username ?? "—"}
                        {s.current && <Badge variant="default">{t("sessions.current")}</Badge>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Expires {new Date(s.expiresAt).toLocaleString()}
                      </p>
                    </div>
                    {!s.current && (
                      <Button size="sm" variant="destructive" onClick={() => revokeMutation.mutate(s.sid)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
