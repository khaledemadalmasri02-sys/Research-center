import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ArrowRight, Printer, Edit, Trash2, Image as ImageIcon, UploadCloud } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { parseVitals, VITAL_DEFS } from "@/lib/vitals-utils";
import { uploadImage } from "@/lib/upload";
import { normalizeRadiologyImages, resolveImageSrc } from "@/lib/radiology-images";
import { useToast } from "@/hooks/use-toast";
import { useDesktopNav } from "@/lib/desktop-nav";

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
  if (paths.length === 0) return null;
  return (
    <div className="bg-card border rounded-lg p-6">
      <h2 className="text-lg font-semibold border-b pb-2 mb-4">
        Radiology Images <span className="text-muted-foreground font-normal text-sm">({paths.length})</span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {paths.map((p, idx) => (
          <a
            key={idx}
            href={toSrc(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="relative group border rounded-lg overflow-hidden bg-muted/30 aspect-square block"
            title={`Image ${idx + 1} — click to open full size`}
          >
            <img
              src={toSrc(p)}
              alt={`Radiology ${idx + 1}`}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs rounded px-1.5 py-0.5">
              {idx + 1}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ImportImagesDialog({ recordId, onImported }: { recordId: number; onImported: () => void }) {
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
      toast({ title: "Enter at least one image URL", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      await appendImages(lines);
      toast({ title: "Import Complete", description: `${lines.length} image(s) linked` });
      setOpen(false);
      setUploadInput("");
    } catch (err) {
      toast({ title: "Import Failed", description: (err as Error).message, variant: "destructive" });
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
      toast({ title: "Upload Complete", description: `${keys.length} file(s) uploaded` });
      setOpen(false);
      setFileInput("");
    } catch (err) {
      toast({ title: "Upload Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (e.target.files) e.target.files = null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ImageIcon className="w-4 h-4 mr-1.5" />
          Import Images
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Images</DialogTitle>
          <DialogDescription>Link image URLs or upload files to this patient record.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="url-input" className="text-sm font-medium">Image URLs</Label>
            <textarea
              id="url-input"
              placeholder="https://example.com/image1.png&#10;https://example.com/image2.jpg"
              className="mt-1 w-full h-20 px-3 py-2 text-sm border rounded-md font-mono"
              value={uploadInput}
              onChange={(e) => setUploadInput(e.target.value)}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground mt-1">One URL per line</p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="border-t border-dashed border-border w-full" />
            </div>
            <span className="relative px-2 text-xs text-muted-foreground bg-popover">or</span>
          </div>

          <div>
            <Label htmlFor="file-input" className="text-sm font-medium">Upload Files</Label>
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
            Cancel
          </Button>
          <Button onClick={handleUrlUpload} disabled={isUploading || !uploadInput.trim()}>
            {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
            Link URLs
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

export default function PatientRecordView() {
  const { id } = useParams();
  const recordId = Number(id);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: def } = useActiveDefinition();
  const dn = useDesktopNav();

  const { data: recData, isLoading } = useQuery({
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
      toast({ title: "Success", description: "Patient record deleted." });
      queryClient.invalidateQueries({ queryKey: ["records", def?.id] });
      setLocation("/patients");
    },
    onError: () => toast({ title: "Error", description: "Failed to delete record.", variant: "destructive" }),
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
        <div className="max-w-5xl mx-auto space-y-8">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      </Layout>
    );
  }

  if (!patient) {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto">
          <p>Patient record not found.</p>
        </div>
      </Layout>
    );
  }

  const images: string[] = normalizeRadiologyImages(data.radiologyImages);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Patient Record</h1>
            <p className="text-muted-foreground mt-1">{data.patientId}</p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
            <Button variant="outline" onClick={() => dn.open("patient-edit", `/patients/${recordId}/edit`)}>
              <Edit className="w-4 h-4 mr-2" /> Edit
            </Button>
            <ImportImagesDialog recordId={recordId} onImported={() => queryClient.invalidateQueries({ queryKey: ["record", recordId] })} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the patient record. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-y py-3">
          <Button variant="outline" onClick={() => previous && setLocation(`/patients/${previous.id}`)} disabled={!previous}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground text-center">
            {currentIndex >= 0 ? `${currentIndex + 1} of ${navigationList.length}` : "Not in current list"}
          </span>
          <Button variant="outline" onClick={() => next && setLocation(`/patients/${next.id}`)} disabled={!next}>
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>

        <div className="space-y-6">
          {data.collectionName || data.collectionDate || data.collectionType ? (
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b border-teal-200 pb-2 mb-4 text-teal-800">Collection Info</h2>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Collection Name" value={data.collectionName} />
                <Field label="Date of Collection" value={fmtDate(data.collectionDate)} />
                {data.collectionType && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-muted-foreground">Type</div>
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          data.collectionType === "Normal"
                            ? "bg-green-100 text-green-800"
                            : data.collectionType === "Abnormal"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
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
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">Patient Information</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Patient ID" value={data.patientId} />
              <Field label="Name" value={data.patientName} />
              <Field label="Age" value={data.age} />
              <Field label="Sex" value={data.sex} />
              <Field label="Date of Visit" value={fmtDate(data.dateOfVisit)} />
            </div>
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">Clinical Presentation</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Chief Complaint" value={data.chiefComplaint} />
              <div className="mb-4">
                <div className="text-sm font-medium text-muted-foreground mb-1">Vital Signs</div>
                <VitalsDisplay value={data.vitalSigns} />
              </div>
            </div>
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">Trauma History</h2>
            <Field label="History" value={data.historyTrauma} />
            <Field label="Mechanism of Injury & Localisation" value={data.mechanismOfInjuryAndLocalisation} />
            <Field label="Signs & Symptoms" value={data.signsAndSymptomsTrauma} />
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">Medical History</h2>
            <Field label="History" value={data.historyMedical} />
            <Field label="Signs & Symptoms" value={data.signsAndSymptomsMedical} />
            <Field label="Risk Factors" value={data.riskFactors} />
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">Diagnosis & Findings</h2>
            <Field label="Provisional Diagnosis" value={data.provisionalDiagnosis} />
            <Field label="Emergency Report" value={data.emergencyReport} />
          </div>

          <RadiologyGallery paths={images} />

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">AI Prediction</h2>
            <Field label="AI Prediction Output" value={data.aiPredictionOutput} />
          </div>

          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-lg font-semibold border-b pb-2 mb-4">Final Diagnosis</h2>
            <Field label="Final Confirmed Diagnosis" value={data.finalConfirmedDiagnosis} />
            <Field label="Final Confirmed Diagnosis (د عزمي)" value={data.finalConfirmedDiagnosisAr} rtl />
            <Field label="Notes" value={data.notes} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
