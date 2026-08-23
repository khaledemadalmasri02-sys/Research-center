import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Reports() {
  const { t } = useTranslation();
  const [patientId, setPatientId] = useState("");

  const download = () => {
    if (!patientId) return;
    window.open(`/api/reports/patient/${patientId}/pdf`, "_blank");
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-7 w-7 text-primary" /> {t("features.reports.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.reports.desc")}</p>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Generate CRF</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label>Patient ID</Label><Input type="number" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="e.g. 12" /></div>
            <Button onClick={download}>Download PDF</Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
