import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Studies() {
  const { t } = useTranslation();
  const studies = useQuery({
    queryKey: ["studies"],
    queryFn: async () => {
      const r = await fetch("/api/studies", { credentials: "include" });
      const d = await r.json();
      return d.studies || d || [];
    },
  });

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-7 w-7 text-primary" /> {t("features.studies.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.studies.desc")}</p>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Research studies</CardTitle></CardHeader>
          <CardContent>
            {studies.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Code</TableHead><TableHead>Title</TableHead><TableHead>IRB</TableHead><TableHead>PI</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(studies.data || []).map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.id}</TableCell><TableCell>{s.code}</TableCell><TableCell>{s.title}</TableCell>
                        <TableCell>{s.irbNumber || "—"}</TableCell><TableCell>{s.piName || "—"}</TableCell><TableCell>{s.status || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!studies.data?.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No studies.</TableCell></TableRow>}
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
