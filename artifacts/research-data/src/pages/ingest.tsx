import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { FadeIn } from "@/lib/page-motion";
import { NoPermissionState } from "@/components/ui/states";

export default function Ingest() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{
    recordId?: number;
    patient?: { patientId?: string; patientName?: string };
  } | null>(null);
  const [error, setError] = useState("");

  const ingest = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ingest/hl7", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "text/plain" },
        body: message,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t("ingest.requestFailed"));
      return d;
    },
    onSuccess: (d) => {
      setResult(d);
      setError("");
    },
    // Any failure clears the previous success line, so a stale "Created record
    // #7" can never sit above a fresh error.
    onError: (e) => {
      setError((e as Error).message);
      setResult(null);
    },
  });

  if (!canEdit) {
    return (
      <Layout>
        <div className="p-4">
          <NoPermissionState
            title={t("ingest.noPermissionTitle")}
            description={t("ingest.noPermissionDesc")}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Upload className="h-7 w-7 text-primary" aria-hidden /> {t("features.ingest.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("features.ingest.desc")}</p>
          </div>
        </FadeIn>
        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("ingest.pasteMessage")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="ingest-hl7" className="sr-only">
                  {t("ingest.msgLabel")}
                </Label>
                <Textarea
                  id="ingest-hl7"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={8}
                  placeholder={"MSH|^~\\&|...&#10;PID|1||12345||DOE^JOHN..."}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </div>
              <Button disabled={!message.trim() || ingest.isPending} onClick={() => ingest.mutate()}>
                {ingest.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />}{" "}
                {t("ingest.btn")}
              </Button>
              {result && (
                <p role="status" className="text-sm text-green-700 dark:text-green-400">
                  {t("ingest.success", {
                    id: result.recordId,
                    patient: result.patient?.patientName || result.patient?.patientId,
                  })}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </Layout>
  );
}
