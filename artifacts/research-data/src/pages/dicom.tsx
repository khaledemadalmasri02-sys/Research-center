import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Image } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { NoPermissionState } from "@/components/ui/states";

const MODALITIES = ["", "CT", "MR", "CR", "DX", "US", "PT", "OT"];

async function getJson(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/**
 * The de-identify endpoint returns **422**, not 200: it strips metadata only
 * and never touches the DICOM pixels. That is a partial result, not a failure
 * and not a success, so `postJson` (which threw on any non-2xx) is NOT used
 * here — the real state is surfaced verbatim.
 */
async function postDeidentify(id: number) {
  const r = await fetch("/api/dicom/deidentify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 422) {
    return { partial: true as const, body: body as DeidOutcome };
  }
  if (!r.ok) {
    throw new Error((body as { error?: string }).error || `${r.status}`);
  }
  return { partial: false as const, body: body as DeidOutcome };
}

interface DeidOutcome {
  pixelsScrubbed?: boolean;
  fullyDeidentified?: boolean;
  requiredNextStep?: string;
  error?: string;
}

export default function Dicom() {
  const { t } = useTranslation();
  const { canEdit } = useAuth();
  const { toast } = useToast();
  const [patientId, setPatientId] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [modality, setModality] = useState("CT");
  const [studies, setStudies] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deidOutcome, setDeidOutcome] = useState<DeidOutcome | null>(null);

  async function loadStudies() {
    if (!patientId) return;
    setLoadError(null);
    try {
      const d = await getJson(`/api/dicom/studies/${encodeURIComponent(patientId)}`);
      setStudies(d.studies || []);
    } catch (e) {
      // Previously `.catch(() => ({ studies: [] }))` — a 403 from the new
      // role gate looked exactly like "this patient has no studies".
      setLoadError(`${t("dicom.loadFailed")} (${(e as Error).message})`);
      setStudies([]);
    }
  }

  async function loadImages() {
    if (!patientId) return;
    setLoadError(null);
    try {
      const d = await getJson(
        `/api/dicom/images?patientId=${encodeURIComponent(patientId)}&limit=200`,
      );
      setImages(d.images || []);
    } catch (e) {
      setLoadError(`${t("dicom.loadFailed")} (${(e as Error).message})`);
      setImages([]);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/dicom/metadata", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: Number(patientId),
          objectKey,
          modality: modality || undefined,
        }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || `${r.status}`);
      return b;
    },
    onSuccess: () => {
      setObjectKey("");
      void loadImages();
    },
    onError: (e) =>
      toast({ title: t("destructive.failed"), description: (e as Error).message, variant: "destructive" }),
  });

  const deid = useMutation({
    mutationFn: (id: number) => postDeidentify(id),
    onSuccess: (res) => {
      setDeidOutcome(res.body);
      void loadImages();
    },
    onError: (e) =>
      toast({ title: t("deidentify.failed"), description: (e as Error).message, variant: "destructive" }),
  });

  if (!canEdit) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <NoPermissionState
            title={t("common.noPermissionTitle")}
            description={t("common.noPermissionDesc")}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Image className="h-7 w-7 text-primary" /> {t("features.dicom.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("features.dicom.desc")}</p>
        </div>

        {loadError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("common.errorTitle")}</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {/* Honest de-identification result. A green "de-identified" badge here
            would be the most dangerous UI bug in the app: the server strips
            metadata only and NEVER touches the pixels. */}
        {deidOutcome && (
          <Alert
            variant={deidOutcome.fullyDeidentified ? "default" : "destructive"}
            role="status"
          >
            <AlertTitle>
              {deidOutcome.fullyDeidentified
                ? t("deidentify.done")
                : t("dicom.metadataOnlyTitle")}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                <li>
                  {t("dicom.pixelsScrubbed")}:{" "}
                  <strong>{deidOutcome.pixelsScrubbed ? t("dicom.yes") : t("dicom.no")}</strong>
                </li>
                <li>
                  {t("dicom.fullyDeidentified")}:{" "}
                  <strong>
                    {deidOutcome.fullyDeidentified ? t("dicom.yes") : t("dicom.no")}
                  </strong>
                </li>
                {deidOutcome.requiredNextStep && (
                  <li>
                    {t("dicom.requiredNextStep")}:{" "}
                    <strong>{deidOutcome.requiredNextStep}</strong>
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("common.patient")}</CardTitle>
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
            <FormRow label={t("dicom.objectKey")} controlClassName="mt-0">
              <Input value={objectKey} onChange={(e) => setObjectKey(e.target.value)} placeholder="R2 key" />
            </FormRow>
            <FormRow label={t("dicom.modality")} controlClassName="mt-0">
              <Select value={modality} onValueChange={setModality}>
                <SelectTrigger className="w-28" aria-label={t("dicom.modality")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODALITIES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <Button
              disabled={!patientId || !objectKey || save.isPending}
              onClick={() => save.mutate()}
            >
              {t("common.save")}
            </Button>
            <Button variant="secondary" onClick={() => void loadStudies()}>
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dicom.studies")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <caption className="sr-only">{t("dicom.studies")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("dicom.studyUid")}</TableHead>
                    <TableHead>{t("dicom.modality")}</TableHead>
                    <TableHead>{t("dicom.bodyPart")}</TableHead>
                    <TableHead>{t("common.date")}</TableHead>
                    <TableHead>{t("dicom.imageCount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studies.map((s: any) => (
                    <TableRow key={s.studyInstanceUid}>
                      <TableCell className="font-mono text-xs">{s.studyInstanceUid}</TableCell>
                      <TableCell>{s.modality || "—"}</TableCell>
                      <TableCell>{s.bodyPart || "—"}</TableCell>
                      <TableCell>{s.acquisitionDate || "—"}</TableCell>
                      <TableCell>{s.imageCount}</TableCell>
                    </TableRow>
                  ))}
                  {!studies.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                        {t("dicom.noStudies")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("patientView.imagesHeading")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <caption className="sr-only">{t("patientView.imagesHeading")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t("dicom.modality")}</TableHead>
                    <TableHead>{t("patientView.deidentifiedStrip")}</TableHead>
                    <TableHead className="text-end">{t("admin.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {images.map((im: any) => (
                    <TableRow key={im.id}>
                      <TableCell>{im.id}</TableCell>
                      <TableCell>{im.modality || "—"}</TableCell>
                      <TableCell>
                        {im.isDeidentified ? (
                          <Badge>{t("dicom.yes")}</Badge>
                        ) : (
                          <span className="text-muted-foreground">{t("dicom.no")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={deid.isPending}
                          onClick={() => deid.mutate(im.id)}
                        >
                          {t("deidentify.stripPhi")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!images.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                        {t("patientView.noImages")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
