import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { downloadAuthenticated } from "@/lib/export-download";

export default function Reports() {
  const { t } = useTranslation();
  /* `viewer` gets 403 on /api/reports/patient/:id/pdf. */
  const { canEdit } = useAuth();
  const { toast } = useToast();
  const [patientId, setPatientId] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * fetch + blob, not `window.open`. A bare navigation to this endpoint puts
   * the PDF URL (carrying a patient id) into browser history and loses the
   * session context; on any non-2xx it used to navigate to raw JSON.
   */
  const download = async () => {
    if (!patientId || busy) return;
    setBusy(true);
    try {
      await downloadAuthenticated(
        `/api/reports/patient/${encodeURIComponent(patientId)}/pdf`,
        `crf-${patientId}.pdf`,
      );
    } catch (e) {
      toast({
        title: t("patients.exportFailed"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
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
          <CardHeader>
            <CardTitle className="text-base">{t("features.reports.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <FormRow label={t("common.patientId")} controlClassName="mt-0">
              <Input
                type="number"
                inputMode="numeric"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="12"
              />
            </FormRow>
            <Button onClick={() => void download()} disabled={!patientId || busy || !canEdit}>
              {t("records.exportCsv")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
