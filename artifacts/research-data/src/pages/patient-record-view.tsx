import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Printer,
  Edit,
  Trash2,
  Image as ImageIcon,
  UploadCloud,
  X,
  ShieldCheck,
  ShieldAlert,
  History,
  FileCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Link } from "wouter";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { ErrorState } from "@/components/ui/states";
import { FormRow } from "@/components/field-row";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordsApi } from "@/lib/records";
import { useActiveDefinition } from "@/lib/records";
import { extractIdFromRoute } from "@/lib/route-params";
import { parseVitals, VITAL_DEFS } from "@/lib/vitals-utils";
import { uploadImage } from "@/lib/upload";
import { normalizeRadiologyImages, resolveImageSrc } from "@/lib/radiology-images";
import { useToast } from "@/hooks/use-toast";
import { useDesktopNav } from "@/lib/desktop-nav";
import { FadeIn } from "@/lib/page-motion";

type RecData = Record<string, any>;

function VitalsDisplay({ value }: { value: string | null | undefined }) {
  const vitals = parseVitals(value);
  const hasAny = VITAL_DEFS.some((d) => vitals[d.key]);
  if (!hasAny) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-1">
      {VITAL_DEFS.map(({ key, label, unit }) =>
        vitals[key] ? (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
            <span className="text-sm font-medium">
              {vitals[key]} <span className="text-xs text-muted-foreground">{unit}</span>
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

function Field({ label, value, rtl }: { label: string; value: string | number | null | undefined; rtl?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm" dir={rtl ? "rtl" : undefined}>
        {value}
      </div>
    </div>
  );
}

function toSrc(p: string) {
  return resolveImageSrc(p);
}

function RadiologyGallery({ paths }: { paths: string[] }) {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Arrow-key navigation + Escape inside the lightbox.
  useEffect(() => {
    if (openIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      else if (e.key === "ArrowRight") setOpenIndex((i) => (i == null ? null : (i + 1) % paths.length));
      else if (e.key === "ArrowLeft") setOpenIndex((i) => (i == null ? null : (i - 1 + paths.length) % paths.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, paths.length]);

  if (paths.length === 0) {
    return (
      <div className="bg-card border rounded-lg p-6">
        <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientView.imagesHeading")}</h2>
        <p className="text-sm text-muted-foreground">{t("patientView.noImages")}</p>
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg p-6">
      <h2 className="text-lg font-semibold border-b pb-2 mb-4">
        {t("patientView.imagesHeading")}{" "}
        <span className="text-muted-foreground font-normal text-sm">({paths.length})</span>
      </h2>
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {paths.map((p, idx) => (
          <li key={p}>
            {/* A full-screen dialog, NOT target="_blank": opening PHI in a new
                tab puts the image URL into browser history and drops the
                authenticated session context. */}
            <button
              type="button"
              onClick={() => setOpenIndex(idx)}
              className="relative group border rounded-lg overflow-hidden bg-muted/30 aspect-square block w-full"
              title={t("a11y.openImageFullScreen", { id: idx + 1 })}
              aria-label={t("a11y.openImageFullScreen", { id: idx + 1 })}
            >
              <img
                src={toSrc(p)}
                alt={t("a11y.patientThumbnail", { id: idx + 1 })}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              <span className="absolute bottom-1 start-1 bg-black/50 text-white text-xs rounded px-1.5 py-0.5">
                {idx + 1}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={openIndex != null} onOpenChange={(v) => !v && setOpenIndex(null)}>
        <DialogContent className="max-w-5xl bg-background">
          <DialogHeader>
            <DialogTitle>{t("patientView.lightboxLabel")}</DialogTitle>
            <DialogDescription>
              {openIndex != null
                ? `${openIndex + 1} / ${paths.length}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            {openIndex != null && (
              <img
                src={toSrc(paths[openIndex])}
                alt={t("a11y.patientThumbnail", { id: openIndex + 1 })}
                decoding="async"
                className="mx-auto max-h-[70vh] w-auto rounded-md object-contain"
              />
            )}
          </div>
          <DialogFooter className="items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setOpenIndex((i) => (i == null ? null : (i - 1 + paths.length) % paths.length))}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
              {t("patientView.lightboxPrev")}
            </Button>
            <Button variant="ghost" onClick={() => setOpenIndex(null)}>
              <X className="h-4 w-4" aria-hidden />
              {t("patientView.lightboxClose")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpenIndex((i) => (i == null ? null : (i + 1) % paths.length))}
            >
              {t("patientView.lightboxNext")}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Consent + de-identification status strip.
 *
 * This page previously showed neither. A clinician reading the record had no
 * way to know whether the data in front of them is consented or
 * de-identified, even though both facts are recorded elsewhere in the app and
 * both are legally material.
 */
function ComplianceStrip({ recordId, deidentified }: { recordId: number; deidentified: boolean | null }) {
  const { t } = useTranslation();

  // `canEdit`-independent read of the consent ledger for this patient.
  const consents = useQuery({
    queryKey: ["consent", recordId],
    queryFn: async () => {
      const r = await fetch(`/api/consent?patientId=${encodeURIComponent(String(recordId))}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as {
        consents?: Array<{ status: string; signedAt?: string; withdrawnAt?: string }>;
      };
    },
    enabled: Number.isFinite(recordId),
    retry: false,
  });

  const rows = consents.data?.consents ?? [];
  const signed = rows.find((c) => c.status === "signed");
  const withdrawn = rows.find((c) => c.status === "withdrawn");

  // Never claim consent is in place while we do not know.
  const consentState =
    consents.isPending
      ? "unknown"
      : consents.isError
      ? "unknown"
      : withdrawn
      ? "withdrawn"
      : signed
      ? "granted"
      : "pending";

  const consentCls =
    consentState === "granted"
      ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
      : consentState === "withdrawn"
      ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
      : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";

  const consentText =
    consentState === "granted"
      ? t("patientView.consentGranted")
      : consentState === "withdrawn"
      ? t("patientView.consentWithdrawn")
      : consentState === "pending"
      ? t("patientView.consentPending")
      : t("patientView.consentUnknown");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 print:hidden">
      <span className="text-sm font-medium text-muted-foreground">
        {t("patientView.consentStrip")}:
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${consentCls}`}
        role="status"
      >
        {consentState === "granted" ? (
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
        )}
        {consentText}
      </span>

      <span className="text-sm font-medium text-muted-foreground ms-2">
        {t("patientView.deidentifiedStrip")}:
      </span>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          deidentified
            ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        {deidentified ? t("patientView.deidentifiedYes") : t("patientView.deidentifiedNo")}
      </span>

      <Button variant="ghost" size="sm" className="ms-auto" asChild>
        <Link href={`/activity/me?entity=record:${recordId}`}>
          <History className="h-4 w-4 rtl:rotate-180" aria-hidden />
          {t("patientView.viewAuditTrail")}
        </Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/consent`}>
          <FileCheck className="h-4 w-4" aria-hidden />
          {t("consent.title")}
        </Link>
      </Button>
    </div>
  );
}

function ImportImagesDialog({ recordId, onImported }: { recordId: number; onImported: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [uploadInput, setUploadInput] = useState("");
  const [fileInput, setFileInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const fileRef = useRef<HTMLInputElement>(null);

  async function appendImages(keys: string[]) {
    const { record } = await recordsApi.getRecord(recordId);
    const current = Array.isArray((record.data as RecData).radiologyImages)
      ? ((record.data as RecData).radiologyImages as string[])
      : [];
    const merged = [...current];
    for (const k of keys) if (!merged.includes(k)) merged.push(k);
    await recordsApi.updateRecord(recordId, { ...(record.data as RecData), radiologyImages: merged });
    queryClient.invalidateQueries({ queryKey: ["record", recordId] });
    onImported();
  }

  async function handleUrlUpload() {
    const lines = uploadInput.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast({ title: t("patientView.urlRequired"), variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      await appendImages(lines);
      toast({
        title: t("patientView.importComplete"),
        description: t("patientView.importCompleteBody", { count: lines.length }),
      });
      setOpen(false);
      setUploadInput("");
    } catch (err) {
      toast({
        title: t("patientView.importFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const keys: string[] = [];
      for (const file of Array.from(files)) {
        keys.push(await uploadImage(file));
      }
      await appendImages(keys);
      toast({
        title: t("patientView.uploadComplete"),
        description: t("patientView.uploadCompleteBody", { count: keys.length }),
      });
      setOpen(false);
      setFileInput("");
    } catch (err) {
      toast({
        title: t("patientView.uploadFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (e.target.files) e.target.files = null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ImageIcon className="w-4 h-4 me-1.5" aria-hidden />
          {t("patientView.importImages")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("patientView.importImages")}</DialogTitle>
          <DialogDescription>{t("patientView.importImagesDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="url-input" className="text-sm font-medium">{t("patientView.imageUrls")}</Label>
            <textarea
              id="url-input"
              placeholder="https://example.com/image1.png&#10;https://example.com/image2.jpg"
              className="mt-1 w-full h-20 px-3 py-2 text-sm border rounded-md font-mono"
              value={uploadInput}
              onChange={(e) => setUploadInput(e.target.value)}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground mt-1">{t("patientView.oneUrlPerLine")}</p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="border-t border-dashed border-border w-full" />
            </div>
            <span className="relative px-2 text-xs text-muted-foreground bg-popover">
              {t("patientView.or")}
            </span>
          </div>

          <div>
            <Label htmlFor="file-input" className="text-sm font-medium">{t("patientView.uploadFiles")}</Label>
            <input
              id="file-input"
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="mt-1 w-full"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isUploading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleUrlUpload} disabled={isUploading || !uploadInput.trim()}>
            {isUploading ? <Loader2 className="w-4 h-4 me-2 animate-spin" aria-hidden /> : (
              <UploadCloud className="w-4 h-4 me-2" aria-hidden />
            )}
            {t("patientView.linkUrls")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmtDate(value?: string | null) {
  if (!value) return null;
  try {
    const d = new Date(value);
    return !isNaN(d.getTime()) ? format(d, "MMM d, yyyy") : value;
  } catch {
    return value;
  }
}

export default function PatientRecordView(props: { route?: string }) {
  const params = useParams<{ id?: string }>();
  // The desktop window manager renders this component directly (without going
  // through wouter's <Route>), so `useParams()` returns `{}`. Fall back to the
  // `route` prop supplied by `Window.tsx` (e.g. "/patients/133" → id=133).
  const paramId = params.id ?? extractIdFromRoute(props.route);
  const recordId = paramId ? Number(paramId) : NaN;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: def } = useActiveDefinition();
  const dn = useDesktopNav();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    data: recData,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => recordsApi.getRecord(recordId),
    enabled: !!recordId,
  });

  const { data: listData } = useQuery({
    queryKey: ["records", def?.id],
    queryFn: () => recordsApi.listRecords(def?.id),
    enabled: !!def?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => recordsApi.deleteRecord(recordId),
        onSuccess: () => {
          toast({ title: t("records.deleted"), description: t("records.deletedBody") });
          queryClient.invalidateQueries({ queryKey: ["records", def?.id] });
          dn.open("patients", "/patients");
        },
    onError: (e) =>
      toast({
        title: t("destructive.failed"),
        description: (e as Error).message || t("records.deleteFailed"),
        variant: "destructive",
      }),
  });

  const patient = recData?.record;
  const data = (patient?.data ?? {}) as RecData;

  const navigationList = useMemo(() => {
    const list = (listData?.records ?? []).slice().sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    );
    return list;
  }, [listData]);

  const currentIndex = navigationList.findIndex((r) => r.id === recordId);
  const previous = currentIndex >= 0 && currentIndex < navigationList.length - 1 ? navigationList[currentIndex + 1] : undefined;
  const next = currentIndex > 0 ? navigationList[currentIndex - 1] : undefined;

  if (isLoading) {
    return (
      <Layout>
        {/* Keyed on the record id: stepping prev/next re-runs the entrance
            instead of hard-cutting between two skeletons. Opacity + transform
            only, so it never delays the paint or steals focus. */}
        <FadeIn key={`skeleton-${recordId}`} y={6} className="max-w-5xl mx-auto space-y-8" aria-busy="true">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </FadeIn>
      </Layout>
    );
  }

  // A failed fetch used to fall through to the "not found" branch, so a 500
  // rendered "Patient record not found." with no alert, no retry, no way back.
  if (isError) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <ErrorState
            title={t("common.errorTitle")}
            description={t("patientView.loadFailed")}
            action={
              <div className="flex gap-2">
                <Button onClick={() => void refetch()} disabled={isFetching}>
                  {t("common.retry")}
                </Button>
                <Button variant="outline" onClick={() => dn.open("patients", "/patients")}>
                  {t("common.goToDashboard")}
                </Button>
              </div>
            }
          />
        </div>
      </Layout>
    );
  }

  if (!patient) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <ErrorState
            title={t("patientView.recordNotFound")}
            action={
              <Button onClick={() => dn.open("patients", "/patients")}>
                {t("common.goToDashboard")}
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  const images: string[] = normalizeRadiologyImages(data.radiologyImages);

  return (
    <Layout>
      {/* Same key discipline as the skeleton above: the record body fades in on
          every record change, which is what makes prev/next read as a
          transition rather than a flicker. Gated on reduced motion by
          `MotionConfig`, which suppresses the transform and keeps the opacity
          fade. */}
      <FadeIn key={`record-${recordId}`} y={8} className="max-w-5xl mx-auto space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/patients">{t("patientView.breadcrumbPatients")}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{data.patientId ?? recordId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex justify-between items-start gap-4 print:hidden">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("patientView.title")}</h1>
            <p className="text-muted-foreground mt-1">{data.patientId}</p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="w-4 h-4 me-2" aria-hidden /> {t("patientView.print")}
            </Button>
            <Button variant="outline" onClick={() => dn.open("patient-edit", `/patients/${recordId}/edit`)}>
              <Edit className="w-4 h-4 me-2" aria-hidden /> {t("common.edit")}
            </Button>
            <ImportImagesDialog recordId={recordId} onImported={() => queryClient.invalidateQueries({ queryKey: ["record", recordId] })} />
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="w-4 h-4 me-2" aria-hidden /> {t("common.delete")}
            </Button>
          </div>
        </div>

        <ComplianceStrip
          recordId={recordId}
          deidentified={data.deidentified === true || data.isDeidentified === true}
        />

        <div className="flex items-center justify-between gap-3 border-y py-3">
            <Button variant="outline" onClick={() => previous && dn.open("patient-view", `/patients/${previous.id}`)} disabled={!previous}>
              <ArrowLeft className="w-4 h-4 me-2 rtl:rotate-180" aria-hidden />
              {t("common.previous")}
            </Button>
          <span
            className="text-sm text-muted-foreground text-center"
            aria-live="polite"
          >
            {currentIndex >= 0
              ? t("patientView.position", { index: currentIndex + 1, total: navigationList.length })
              : t("common.unknown")}
          </span>
            <Button variant="outline" onClick={() => next && dn.open("patient-view", `/patients/${next.id}`)} disabled={!next}>
              {t("common.next")}
              <ArrowRight className="w-4 h-4 ms-2 rtl:rotate-180" aria-hidden />
            </Button>
        </div>

        <div className="space-y-6">
          {data.collectionName || data.collectionDate || data.collectionType ? (
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-6 dark:border-teal-900 dark:bg-teal-950/40">
              <h2 className="text-lg font-semibold border-b border-teal-200 pb-2 mb-4 text-teal-900 dark:border-teal-900 dark:text-teal-100">
                {t("patientForm.sectionCollection")}
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <Field label={t("patientForm.fCollectionName")} value={data.collectionName} />
                <Field label={t("patientForm.fCollectionDate")} value={fmtDate(data.collectionDate)} />
                {data.collectionType && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-muted-foreground">
                      {t("patientForm.fCollectionType")}
                    </div>
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          data.collectionType === "Normal"
                            ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
                            : data.collectionType === "Abnormal"
                            ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                            : "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200"
                        }`}
                      >
                        {data.collectionType}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionPatient")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label={t("patientForm.fPatientId")} value={data.patientId} />
              <Field label={t("patientForm.fPatientName")} value={data.patientName} />
              <Field label={t("patientForm.fAge")} value={data.age} />
              <Field label={t("patientForm.fSex")} value={data.sex} />
              <Field label={t("patientForm.fDateOfVisit")} value={fmtDate(data.dateOfVisit)} />
            </div>
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionPresentation")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("patientForm.fChiefComplaint")} value={data.chiefComplaint} />
              <div className="mb-4">
                <div className="text-sm font-medium text-muted-foreground mb-1">{t("patientForm.fVitals")}</div>
                <VitalsDisplay value={data.vitalSigns} />
              </div>
            </div>
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionTrauma")}</h2>
            <Field label={t("patientForm.fHistory")} value={data.historyTrauma} />
            <Field label={t("patientForm.fMechanism")} value={data.mechanismOfInjuryAndLocalisation} />
            <Field label={t("patientForm.fSignsTrauma")} value={data.signsAndSymptomsTrauma} />
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionMedical")}</h2>
            <Field label={t("patientForm.fHistory")} value={data.historyMedical} />
            <Field label={t("patientForm.fSignsMedical")} value={data.signsAndSymptomsMedical} />
            <Field label={t("patientForm.fRiskFactors")} value={data.riskFactors} />
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionDiagnosis")}</h2>
            <Field label={t("patientForm.fProvisional")} value={data.provisionalDiagnosis} />
            <Field label={t("patientForm.fEmergency")} value={data.emergencyReport} />
          </div>

          <RadiologyGallery paths={images} />

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionAi")}</h2>
            <Field label={t("patientForm.fAiOutput")} value={data.aiPredictionOutput} />
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t("patientForm.sectionFinal")}</h2>
            <Field label={t("patientForm.fFinalDiagnosis")} value={data.finalConfirmedDiagnosis} />
            <Field label={t("patientForm.fFinalDiagnosisAr")} value={data.finalConfirmedDiagnosisAr} rtl />
            <Field label={t("patientForm.fNotes")} value={data.notes} />
          </div>
        </div>
      </FadeIn>

      <ConfirmDestructive
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("records.deleteTitle")}
        description={t("destructive.body")}
        subject={`${data.patientName ?? ""} · ${data.patientId ?? recordId}`}
        confirmLabel={t("common.delete")}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </Layout>
  );
}
