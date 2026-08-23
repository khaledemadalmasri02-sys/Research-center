import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function ExportPage() {
  const { t } = useTranslation();
  const [recordId, setRecordId] = useState("");

  const download = async (kind: "fhir" | "hl7") => {
    if (!recordId) return;
    const url = `/api/export/${kind}?recordId=${encodeURIComponent(recordId)}`;
    window.open(url, "_blank");
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Download className="h-7 w-7 text-primary" /> {t("features.export.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.export.desc")}</p>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Export a record</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label>Record ID</Label><Input type="number" value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="e.g. 5" /></div>
            <Button onClick={() => download("fhir")}>Download FHIR</Button>
            <Button variant="secondary" onClick={() => download("hl7")}>Download HL7 v2</Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
