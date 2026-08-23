import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eraser } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

export default function Deidentify() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const [studyCode, setStudyCode] = useState("");
  const [patientId, setPatientId] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resolve = async () => {
    setError(""); setBusy(true);
    try {
      const res = await fetch("/api/deidentify/pseudonym", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: Number(patientId), studyCode }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setPseudonym(d.pseudonym);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const download = (log: boolean) => {
    const url = `/api/deidentify/export?studyCode=${encodeURIComponent(studyCode)}${log ? "" : ""}`;
    window.open(url, "_blank");
  };

  if (!canEdit) return <Layout><div className="p-4 text-sm text-muted-foreground">Editor access required.</div></Layout>;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Eraser className="h-7 w-7 text-primary" /> {t("features.deidentify.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.deidentify.desc")}</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Generate pseudonym</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Study code</Label>
              <Input value={studyCode} onChange={(e) => setStudyCode(e.target.value)} placeholder="e.g. STUDY-1" />
            </div>
            <div className="space-y-1">
              <Label>Patient ID</Label>
              <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="e.g. 12" />
            </div>
            <Button disabled={!studyCode || !patientId || busy} onClick={resolve}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Resolve
            </Button>
            {pseudonym && <Badge className="ml-2">{pseudonym}</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Export de-identified dataset</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="secondary" disabled={!studyCode} onClick={() => download(false)}>
              Preview CSV
            </Button>
            <Button disabled={!studyCode} onClick={() => download(true)}>
              Export &amp; log job
            </Button>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Layout>
  );
}
