import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { downloadAuthenticated } from "@/lib/export-download";

export default function ExportPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [recordId, setRecordId] = useState("");

  /**
   * `window.open(url, "_blank")` navigated the SPA to raw JSON whenever the
   * server answered 401/500 instead of a file, and left the record id in
   * browser history. fetch + blob keeps the SPA in place and surfaces failures.
   */
  const download = async (kind: "fhir" | "hl7") => {
    if (!recordId) return;
    try {
      await downloadAuthenticated(
        `/api/export/${kind}?recordId=${encodeURIComponent(recordId)}`,
        `record-${recordId}.${kind === "fhir" ? "json" : "hl7"}`,
      );
      toast({ title: t("patients.exportComplete") });
    } catch (e) {
      toast({
        title: t("patients.exportFailed"),
        description: (e as Error).message,
        variant: "destructive",
      });
    }
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
          <CardHeader>
            <CardTitle className="text-base">{t("features.export.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <FormRow label={t("common.patientId")} controlClassName="mt-0">
              <Input
                type="number"
                inputMode="numeric"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                placeholder="5"
              />
            </FormRow>
            <Button onClick={() => void download("fhir")}>FHIR</Button>
            <Button variant="secondary" onClick={() => void download("hl7")}>HL7 v2</Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
