import { useState, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/field-row";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Image as ImageIcon, Upload, Link, Loader2, Check, X } from "lucide-react";
import { getListPatientsQueryKey } from "@workspace/api-client-react";
import {
  PatientCombobox,
  type PatientOption,
} from "@/components/patient-combobox";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batchSize?: number;
};

type UploadFile = {
  /** Stable React key. `key={index}` made React reuse the wrong row after a
   *  removal, which in this table means showing one file's assignment next to
   *  another file's name. */
  uid: string;
  file: File;
  /** Filename-derived *suggestion* only. Never applied without confirmation. */
  suggestedPatientId: string | null;
  /** The operator's confirmed choice. Unset => the file is NOT uploaded. */
  patient: PatientOption | null;
  error?: string;
};

const PATIENT_ID_PATTERNS = [
  /PAT(\d+)/i,
  /patient[_-]?(\d+)/i,
  /id[_-]?(\d+)/i,
  /(\d{5,})/,
];

function extractPatientIdFromFilename(filename: string): string | null {
  // Strip the file extension, then drop any "(1)"/"(2)" style suffixes BEFORE
  // extracting digits so "89373(1).png" resolves to 89373 (not 893731).
  const base = filename.replace(/\.[^/.]+$/, "");
  const name = base.replace(/\(\d+\)/g, "").replace(/[().]/g, "");
  for (const pattern of PATIENT_ID_PATTERNS) {
    const match = name.match(pattern);
    if (match?.[1]) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 4) {
        return `PAT${digits}`;
      }
    }
  }
  return null;
}

let uidCounter = 0;
const nextUid = () => `img-${++uidCounter}`;

export function ImportImagesDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"upload" | "urls">("upload");
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [currentBatch, setCurrentBatch] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [files, setFiles] = useState<UploadFile[]>([]);
  /** Default patient for the URL tab. */
  const [urlPatient, setUrlPatient] = useState<PatientOption | null>(null);

  const handleFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const newFiles = Array.from(selectedFiles).map((file) => ({
      uid: nextUid(),
      file,
      suggestedPatientId: extractPatientIdFromFilename(file.name),
      patient: null,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const assigned = useMemo(() => files.filter((f) => f.patient !== null), [files]);
  const unassignedCount = files.length - assigned.length;
  const canUpload = files.length > 0 && unassignedCount === 0;

  const handleFileUploads = async () => {
    if (files.length === 0) {
      toast({ title: t("common.unknown"), variant: "destructive" });
      return;
    }
    /**
     * HARD GATE. Previously a file with no detected patient id was flagged in
     * amber (~2.9:1 contrast) and then uploaded anyway, which allowed a
     * radiology image to be attached to the wrong — or a nonexistent —
     * patient with no confirmation and no existence check.
     */
    if (unassignedCount > 0) {
      toast({
        title: t("importImages.unassignedWarning", { count: unassignedCount }),
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setCurrentBatch(0);
    const total = files.length;
    setTotalFiles(total);

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Sequential: same-patient uploads must not race.
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      setCurrentBatch(i + 1);

      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(item.file);
        });
        const match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/i);
        const base64Data = match ? match[1] : dataUrl;

        const res = await fetch("/api/storage/upload-file", {
          method: "POST",
          headers: { "Content-Type": "application/json", credentials: "include" },
          body: JSON.stringify({
            // Always the *confirmed* patient, never the filename guess.
            patientId: item.patient?.patientId ?? String(item.patient?.recordId ?? ""),
            recordId: item.patient?.recordId,
            filename: item.file.name,
            contentType: item.file.type,
            fileData: base64Data,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          failCount++;
          const message = (err as { error?: string }).error || t("importImages.failed");
          setFiles((prev) =>
            prev.map((f) => (f.uid === item.uid ? { ...f, error: message } : f)),
          );
          errors.push(message);
        } else {
          successCount++;
        }
      } catch {
        failCount++;
        setFiles((prev) =>
          prev.map((f) => (f.uid === item.uid ? { ...f, error: t("common.unknown") } : f)),
        );
        errors.push(t("common.unknown"));
      }
    }

    setUploading(false);
    setCurrentBatch(0);
    queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    toast({
      title: t("importImages.uploaded", { count: successCount }),
      description:
        failCount > 0 ? t("importExcel.resultFailedCount", { count: failCount }) : undefined,
      variant: failCount > 0 ? "destructive" : "default",
    });
    if (failCount === 0) {
      onOpenChange(false);
      setFiles([]);
    }
    setUrlInput("");
  };

  const handleUrlImport = async () => {
    const urls = urlInput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && (l.startsWith("http://") || l.startsWith("https://")));

    if (urls.length === 0) {
      toast({ title: t("importExcel.noValidData"), variant: "destructive" });
      return;
    }
    if (!urlPatient) {
      toast({ title: t("importImages.choosePatient"), variant: "destructive" });
      return;
    }

    setUploading(true);
    setTotalFiles(1);
    setCurrentBatch(1);

    try {
      const res = await fetch("/api/patients/batch-import-images", {
        method: "POST",
        headers: { "Content-Type": "application/json", credentials: "include" },
        body: JSON.stringify({
          patientId: urlPatient.patientId ?? String(urlPatient.recordId),
          recordId: urlPatient.recordId,
          imageUrls: urls,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || t("importImages.failed"));
      }
      const linked = data.results?.filter((r: { status: string }) => r.status === "linked").length ?? data.uploaded;
      const orphaned =
        data.results?.filter((r: { status: string }) => r.status === "orphaned").length ?? 0;
      toast({
        title: t("importImages.uploaded", { count: linked }),
        description: orphaned
          ? t("importExcel.resultFailedCount", { count: orphaned })
          : undefined,
        variant: orphaned > 0 ? "destructive" : "default",
      });
      onOpenChange(false);
      setUrlInput("");
      setUrlPatient(null);
      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    } catch (e) {
      toast({
        title: t("importImages.failed"),
        description: (e as Error).message || t("common.unknown"),
        variant: "destructive",
      });
    }

    setUploading(false);
    setCurrentBatch(0);
    setTotalFiles(0);
  };

  const progress = totalFiles > 0 ? Math.round((currentBatch / totalFiles) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("importImages.title")}</DialogTitle>
          <DialogDescription>{t("importImages.description")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab as never} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              {t("importExcel.uploadTab")}
            </TabsTrigger>
            <TabsTrigger value="urls" className="cursor-pointer">
              <Link className="w-4 h-4 mr-2" />
              {t("importExcel.urlsTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex-1 flex flex-col gap-4 mt-4">
            <div>
              <Input
                type="file"
                accept="image/*"
                multiple
                ref={fileInputRef}
                className="sr-only"
                aria-label={t("importExcel.chooseFiles")}
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-auto w-full flex-col gap-2 border-2 border-dashed border-border py-8 hover:border-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-muted-foreground" />
                <span className="font-medium">{t("importImages.assignmentTitle")}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t("importExcel.chooseFilesHint")}
                </span>
              </Button>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  {t("importImages.assignmentTitle")} ({assigned.length}/{files.length})
                </h4>

                {unassignedCount > 0 && (
                  <p
                    role="alert"
                    className="rounded-md border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                  >
                    {t("importImages.unassignedWarning", { count: unassignedCount })}
                  </p>
                )}

                {/* file -> patient assignment table (pre-upload) */}
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {files.map((item) => (
                    <li
                      key={item.uid}
                      className="flex flex-wrap items-center gap-3 p-2 border rounded bg-muted/20"
                    >
                      <ImageIcon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-[8rem] flex-1">
                        <span className="text-sm font-medium block truncate">{item.file.name}</span>
                        {item.suggestedPatientId && !item.patient && (
                          <span className="text-xs text-muted-foreground">
                            {t("importImages.inferredPatient")}:{" "}
                            <span className="font-mono">{item.suggestedPatientId}</span>
                          </span>
                        )}
                      </div>

                      <div className="w-[220px] shrink-0">
                        <PatientCombobox
                          value={item.patient}
                          onChange={(v) =>
                            setFiles((prev) =>
                              prev.map((f) =>
                                f.uid === item.uid ? { ...f, patient: v, error: undefined } : f,
                              ),
                            )
                          }
                          placeholder={t("importImages.choosePatient")}
                          invalid={!item.patient}
                        />
                      </div>

                      {!uploading && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`${t("common.delete")}: ${item.file.name}`}
                          onClick={() => setFiles((prev) => prev.filter((f) => f.uid !== item.uid))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}

                      {item.error && (
                        <span className="text-xs text-destructive" role="status">
                          {item.error.length > 40 ? `${item.error.slice(0, 40)}…` : item.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <Button variant="outline" size="sm" onClick={() => setFiles([])} disabled={uploading}>
                  {t("common.delete")}
                </Button>
              </div>
            )}

            {uploading && totalFiles > 0 && (
              <div className="space-y-2">
                <div
                  className="flex items-center gap-2"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">
                    {t("importExcel.progress", { done: currentBatch, total: totalFiles })}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <Button
              onClick={handleFileUploads}
              disabled={uploading || !canUpload}
              className="w-full"
              title={unassignedCount > 0 ? t("importImages.unassignedWarning", { count: unassignedCount }) : undefined}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {uploading
                ? t("importImages.uploading")
                : t("importImages.upload", { count: files.length })}
            </Button>
          </TabsContent>

          <TabsContent value="urls" className="flex-1 flex flex-col gap-4 mt-4">
            <div className="space-y-2">
              <FormRow
                label={t("importImages.choosePatient")}
                required
                markRequired
                controlClassName="mt-0"
              >
                <PatientCombobox value={urlPatient} onChange={setUrlPatient} />
              </FormRow>
              <FormRow label={t("importImages.file")} controlClassName="mt-0">
                <textarea
                  placeholder={"https://example.com/image1.png\nhttps://example.com/image2.jpg"}
                  aria-label={t("importImages.file")}
                  className="w-full h-32 p-3 border rounded-md font-mono text-sm"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={uploading}
                />
              </FormRow>
              <p className="text-xs text-muted-foreground">{t("importExcel.urlHint")}</p>
            </div>

            {uploading && totalFiles > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2" role="status" aria-live="polite">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">{t("importImages.uploading")}</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <Button
              onClick={handleUrlImport}
              disabled={uploading || urlInput.trim() === "" || !urlPatient}
              className="w-full"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Link className="w-4 h-4 mr-2" />
              )}
              {t("importExcel.urlImport")}
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setTab("upload");
              setFiles([]);
              setUrlInput("");
              setUrlPatient(null);
              setCurrentBatch(0);
              setTotalFiles(0);
            }}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}