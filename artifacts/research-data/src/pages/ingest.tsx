import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";

export default function Ingest() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const ingest = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ingest/hl7", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "text/plain" },
        body: message,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      return d;
    },
    onSuccess: (d) => { setResult(d); setError(""); },
    onError: (e) => { setError((e as Error).message); setResult(null); },
  });

  if (!canEdit) return <Layout><div className="p-4 text-sm text-muted-foreground">Editor access required.</div></Layout>;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Upload className="h-7 w-7 text-primary" /> {t("features.ingest.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.ingest.desc")}</p>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Paste HL7 v2 message</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={8} placeholder="MSH|^~\&|...&#10;PID|1||12345||DOE^JOHN..." className="font-mono text-xs" />
            <Button disabled={!message.trim() || ingest.isPending} onClick={() => ingest.mutate()}>
              {ingest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Ingest
            </Button>
            {result && <p className="text-sm text-green-600">Created record #{result.recordId} for {result.patient?.patientName || result.patient?.patientId}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
