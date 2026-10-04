import { useState } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { Loader2, Eraser } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { NoPermissionState } from "@/components/ui/states";
import { downloadAuthenticated } from "@/lib/export-download";

export default function Deidentify() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const { toast } = useToast();
  const [studyCode, setStudyCode] = useState("");
  const [patientId, setPatientId] = useState("");
  const [pseudonym, setPseudonym] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resolve = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/deidentify/pseudonym", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: Number(patientId), studyCode }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || t("destructive.failed"));
      setPseudonym(d.pseudonym);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The export endpoint is a mutating **POST** now. A browser navigation
   * cannot send `X-CSRF-Token`, and `SameSite=Lax` allows top-level GET
   * navigation cross-site — which is how an `<img>` on any page could write
   * attacker-controlled rows. `installCsrfFetch()` in `main.tsx` attaches the
   * token to mutating same-origin `/api` POSTs, so no manual header here.
   *
   * Also: the route 409s when the D1 `patients` table is empty (i.e. always
   * today). A 0-row CSV reads as a successful de-identification run, so a
   * non-2xx is surfaced as an explicit error rather than a silent file.
   *
   * There is no longer a `?log` distinction: *every* POST is audit-logged, so
   * the old "Preview" vs "Export & log job" pair is now one action.
   */
  const download = async () => {
    setError("");
    setBusy(true);
    try {
      await downloadAuthenticated(
        `/api/deidentify/export?studyCode=${encodeURIComponent(studyCode)}`,
        `deidentified-${studyCode || "dataset"}.csv`,
        { method: "POST" },
      );
      toast({ title: t("deidentify.done") });
    } catch (e) {
      const message = (e as Error).message || t("deidentify.failed");
      setError(message);
      toast({ title: t("deidentify.failed"), description: message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <NoPermissionState
            title={t("deidentify.noPermissionTitle")}
            description={t("deidentify.noPermissionDesc")}
          />
        </div>
      </Layout>
    );
  }

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
          <CardHeader>
            <CardTitle className="text-base">{t("deidentify.patient")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <FormRow label={t("consent.patient")} controlClassName="mt-0">
              <Input
                value={studyCode}
                onChange={(e) => setStudyCode(e.target.value)}
                placeholder="STUDY-1"
                aria-label={t("consent.patient")}
              />
            </FormRow>
            <FormRow label={t("common.patientId")} controlClassName="mt-0">
              <Input
                type="number"
                inputMode="numeric"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="12"
              />
            </FormRow>
            <Button disabled={!studyCode || !patientId || busy} onClick={resolve}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("common.confirm")}
            </Button>
            {pseudonym && <Badge className="ms-2">{pseudonym}</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("deidentify.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button disabled={!studyCode || busy} onClick={() => void download()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("patients.exportCsv")}
            </Button>
          </CardContent>
        </Card>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Layout>
  );
}
