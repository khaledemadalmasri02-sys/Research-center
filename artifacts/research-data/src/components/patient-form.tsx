import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState, useCallback } from "react";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useCreatePatient, useUpdatePatient, getListPatientsQueryKey, getGetPatientStatsQueryKey, getGetPatientQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpload } from "@workspace/object-storage-web";
import { Upload, X, ImageIcon, Loader2, Clipboard, Plus } from "lucide-react";
import { VoiceDictationTextarea } from "@/components/voice-dictation-textarea";
import { parseVitals, serializeVitals, VITAL_DEFS } from "@/lib/vitals-utils";

function VitalSignsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const vitals = parseVitals(value);
  function update(key: string, val: string) {
    onChange(serializeVitals({ ...vitals, [key]: val }));
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 pt-1">
      {VITAL_DEFS.map(({ key, label, placeholder, unit }) => (
        <div key={key} className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
          <div className="relative">
            <Input
              value={vitals[key as keyof typeof vitals]}
              onChange={(e) => update(key, e.target.value)}
              placeholder={placeholder}
              className="pr-9 text-sm h-9"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60 pointer-events-none leading-tight text-right">
              {unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const todayISO = () => new Date().toISOString().split("T")[0];

const patientSchema = z.object({
  collectionName: z.string().nullable().optional(),
  collectionDate: z.string().nullable().optional(),
  collectionType: z.enum(["Normal", "Abnormal", "Suspicious"]).nullable().optional(),
  patientId: z.string().min(1, "Patient ID is required"),
  patientName: z.string().min(1, "Patient Name is required"),
  age: z.coerce.number().nullable().optional(),
  sex: z.enum(["Male", "Female", "Other"]).nullable().optional(),
  dateOfVisit: z.string().nullable().optional(),
  chiefComplaint: z.string().nullable().optional(),
  vitalSigns: z.string().nullable().optional(),
  historyTrauma: z.string().nullable().optional(),
  mechanismOfInjuryAndLocalisation: z.string().nullable().optional(),
  signsAndSymptomsTrauma: z.string().nullable().optional(),
  historyMedical: z.string().nullable().optional(),
  signsAndSymptomsMedical: z.string().nullable().optional(),
  riskFactors: z.string().nullable().optional(),
  provisionalDiagnosis: z.string().nullable().optional(),
  radiologyImageFilePathOrLink: z.string().nullable().optional(),
  radiologyImages: z.string().nullable().optional(), // JSON array of paths
  emergencyReport: z.string().nullable().optional(),
  aiPredictionOutput: z.string().nullable().optional(),
  finalConfirmedDiagnosisAr: z.string().nullable().optional(),
  finalConfirmedDiagnosis: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type PatientFormValues = z.infer<typeof patientSchema>;

interface PatientFormProps {
  initialData?: any;
  isEdit?: boolean;
}

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/_+/g, "_");
}

function parsePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return raw ? [raw] : []; }
}

function MultiRadiologyUploader({
  value,
  onChange,
  patientId,
  patientName,
}: {
  value: string | null | undefined;
  onChange: (val: string) => void;
  patientId?: string;
  patientName?: string;
}) {
  const { toast } = useToast();
  const [isPasteFocused, setIsPasteFocused] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);

  const paths = parsePaths(value);
  const isUploading = uploadingCount > 0;

  const { uploadFile } = useUpload({
    onSuccess: () => {},
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const uploadOne = useCallback(async (file: File): Promise<string | null> => {
    const rawExt = file.type ? file.type.split("/").pop() : "png";
    const ext = rawExt === "jpeg" ? "jpg" : (rawExt || "png");
    const id = sanitizeFilename(patientId || "unknown");
    const nm = sanitizeFilename(patientName || "patient");
    const ts = Date.now();
    const renamedFile = new File([file], `${id}_${nm}_${ts}.${ext}`, { type: file.type });
    return new Promise((resolve) => {
      uploadFile(renamedFile)
        .then((resp: any) => resolve(resp?.objectPath ?? null))
        .catch(() => resolve(null));
    });
  }, [uploadFile, patientId, patientName]);

  const addPaths = useCallback((newPaths: string[]) => {
    const next = [...paths, ...newPaths.filter(Boolean)];
    onChange(JSON.stringify(next));
  }, [paths, onChange]);

  const removeAt = (idx: number) => {
    const next = paths.filter((_, i) => i !== idx);
    onChange(JSON.stringify(next));
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploadingCount((c) => c + files.length);
    const uploaded: string[] = [];
    for (const file of files) {
      const path = await uploadOne(file);
      if (path) uploaded.push(path);
    }
    setUploadingCount((c) => c - files.length);
    if (uploaded.length) {
      addPaths(uploaded);
      toast({ title: `${uploaded.length} image(s) uploaded` });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await handleFiles(files);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((i) => i.getAsFile()).filter(Boolean) as File[];
    await handleFiles(files);
  };

  return (
    <div className="space-y-4">
      {/* Upload controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium cursor-pointer transition-colors
          ${isUploading ? "opacity-60 cursor-not-allowed bg-muted" : "bg-background hover:bg-muted border-input"}`}>
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {isUploading ? `Uploading ${uploadingCount}…` : "Upload Images"}
          <input type="file" accept="image/*,.dcm,.dicom" multiple className="sr-only"
            disabled={isUploading} onChange={handleFileChange} data-testid="input-radiology-file" />
        </label>

        <div
          tabIndex={0}
          onPaste={handlePaste}
          onFocus={() => setIsPasteFocused(true)}
          onBlur={() => setIsPasteFocused(false)}
          data-testid="paste-zone"
          className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium cursor-pointer select-none outline-none transition-all
            ${isUploading ? "opacity-60 cursor-not-allowed bg-muted border-input"
              : isPasteFocused ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20"
              : "border-dashed border-input bg-background hover:border-primary hover:bg-primary/5 hover:text-primary text-muted-foreground"}`}
          title="Click here then press Ctrl+V / Cmd+V to paste a screenshot"
        >
          <Clipboard className="w-4 h-4" />
          {isPasteFocused ? "Ready — press Ctrl+V / Cmd+V" : "Paste Screenshot"}
        </div>
      </div>

      {/* Image gallery */}
      {paths.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {paths.map((p, idx) => (
            <div key={idx} className="relative group border rounded-lg overflow-hidden bg-muted/30 aspect-square">
              <img
                src={p.startsWith("/objects/") ? `/api/storage${p}` : p}
                alt={`Radiology ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove image"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs rounded px-1">
                {idx + 1}
              </span>
            </div>
          ))}
          {isUploading && (
            <div className="border-2 border-dashed rounded-lg aspect-square flex items-center justify-center bg-muted/20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {paths.length === 0 && !isUploading && (
        <div className="border-2 border-dashed rounded-lg p-6 text-center text-muted-foreground text-sm">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No images yet — upload files or paste a screenshot
        </div>
      )}

      {paths.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Plus className="w-3 h-3" /> {paths.length} image(s) — upload or paste to add more
        </p>
      )}

    </div>
  );
}

export function PatientForm({ initialData, isEdit }: PatientFormProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createPatient = useCreatePatient();
  const updatePatient = useUpdatePatient();

  const defaultValues: Partial<PatientFormValues> = {
    collectionName: initialData?.collectionName || "",
    collectionDate: initialData?.collectionDate || todayISO(),
    collectionType: initialData?.collectionType || null,
    patientId: initialData?.patientId || "",
    patientName: initialData?.patientName || "",
    age: initialData?.age || null,
    sex: initialData?.sex || null,
    dateOfVisit: initialData?.dateOfVisit ? new Date(initialData.dateOfVisit).toISOString().split('T')[0] : "",
    chiefComplaint: initialData?.chiefComplaint || "",
    vitalSigns: initialData?.vitalSigns || "",
    historyTrauma: initialData?.historyTrauma || "",
    mechanismOfInjuryAndLocalisation: initialData?.mechanismOfInjuryAndLocalisation || "",
    signsAndSymptomsTrauma: initialData?.signsAndSymptomsTrauma || "",
    historyMedical: initialData?.historyMedical || "",
    signsAndSymptomsMedical: initialData?.signsAndSymptomsMedical || "",
    riskFactors: initialData?.riskFactors || "",
    provisionalDiagnosis: initialData?.provisionalDiagnosis || "",
    radiologyImageFilePathOrLink: initialData?.radiologyImageFilePathOrLink || "",
    radiologyImages: initialData?.radiologyImages || "",
    emergencyReport: initialData?.emergencyReport || "",
    aiPredictionOutput: initialData?.aiPredictionOutput || "",
    finalConfirmedDiagnosisAr: initialData?.finalConfirmedDiagnosisAr || "",
    finalConfirmedDiagnosis: initialData?.finalConfirmedDiagnosis || "",
    notes: initialData?.notes || "",
  };

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
    defaultValues,
  });

  const watchedPatientId = form.watch("patientId");
  const watchedPatientName = form.watch("patientName");

  const onSubmit = async (data: PatientFormValues) => {
    try {
      if (isEdit && initialData?.id) {
        await updatePatient.mutateAsync({ id: initialData.id, data });
        toast({ title: "Success", description: "Patient record updated." });
        queryClient.invalidateQueries({ queryKey: getGetPatientQueryKey(initialData.id) });
      } else {
        const res = await createPatient.mutateAsync({ data });
        toast({ title: "Success", description: "Patient record created." });
        setLocation(`/patients/${res.id}`);
      }
      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPatientStatsQueryKey() });
      if (!isEdit) {
        setLocation("/patients");
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save record.", variant: "destructive" });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

        <div className="bg-teal-50 border border-teal-200 rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b border-teal-200 pb-2 mb-4 text-teal-800">Collection Info</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField control={form.control} name="collectionName" render={({ field }) => (
              <FormItem>
                <FormLabel>Collection Name</FormLabel>
                <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Trauma Study 2026" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="collectionDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Date of Collection</FormLabel>
                <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="collectionType" render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="Abnormal">Abnormal</SelectItem>
                    <SelectItem value="Suspicious">Suspicious</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Patient Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <FormField control={form.control} name="patientId" render={({ field }) => (
              <FormItem>
                <FormLabel>Patient ID</FormLabel>
                <FormControl><Input {...field} value={field.value || ""} data-testid="input-patient-id" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="patientName" render={({ field }) => (
              <FormItem>
                <FormLabel>Patient Name</FormLabel>
                <FormControl><Input {...field} value={field.value || ""} data-testid="input-patient-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="age" render={({ field }) => (
              <FormItem>
                <FormLabel>Age</FormLabel>
                <FormControl><Input type="number" {...field} value={field.value || ""} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : null)} data-testid="input-age" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="sex" render={({ field }) => (
              <FormItem>
                <FormLabel>Sex</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                  <FormControl>
                    <SelectTrigger data-testid="select-sex"><SelectValue placeholder="Select sex" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Clinical Presentation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="dateOfVisit" render={({ field }) => (
              <FormItem>
                <FormLabel>Date of Visit</FormLabel>
                <FormControl><Input type="date" {...field} value={field.value || ""} data-testid="input-date-of-visit" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="vitalSigns" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Vital Signs</FormLabel>
                <FormControl>
                  <VitalSignsInput value={field.value || ""} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="chiefComplaint" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Chief Complaint</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} data-testid="textarea-chief-complaint" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Trauma History</h2>
          <div className="grid grid-cols-1 gap-4">
            <FormField control={form.control} name="historyTrauma" render={({ field }) => (
              <FormItem>
                <FormLabel>History (Trauma)</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="mechanismOfInjuryAndLocalisation" render={({ field }) => (
              <FormItem>
                <FormLabel>Mechanism of Injury & Localisation</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="signsAndSymptomsTrauma" render={({ field }) => (
              <FormItem>
                <FormLabel>Signs & Symptoms (Trauma)</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Medical History</h2>
          <div className="grid grid-cols-1 gap-4">
            <FormField control={form.control} name="historyMedical" render={({ field }) => (
              <FormItem>
                <FormLabel>History (Medical)</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="signsAndSymptomsMedical" render={({ field }) => (
              <FormItem>
                <FormLabel>Signs & Symptoms (Medical)</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="riskFactors" render={({ field }) => (
              <FormItem>
                <FormLabel>Risk Factors</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Diagnosis & Findings</h2>
          <div className="grid grid-cols-1 gap-4">
            <FormField control={form.control} name="provisionalDiagnosis" render={({ field }) => (
              <FormItem>
                <FormLabel>Provisional Diagnosis</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="emergencyReport" render={({ field }) => (
              <FormItem>
                <FormLabel>Emergency Report</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Radiology & AI</h2>
          <div className="grid grid-cols-1 gap-4">
            <FormField control={form.control} name="radiologyImages" render={({ field }) => (
              <FormItem>
                <FormLabel>Radiology Images</FormLabel>
                <FormControl>
                  <MultiRadiologyUploader
                    value={field.value}
                    onChange={field.onChange}
                    patientId={watchedPatientId}
                    patientName={watchedPatientName}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="aiPredictionOutput" render={({ field }) => (
              <FormItem>
                <FormLabel>AI Prediction Output</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold border-b pb-2 mb-4">Final Diagnosis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="finalConfirmedDiagnosis" render={({ field }) => (
              <FormItem>
                <FormLabel>Final Confirmed Diagnosis</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="finalConfirmedDiagnosisAr" render={({ field }) => (
              <FormItem>
                <FormLabel>Final Confirmed Diagnosis (د عزمي)</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} dir="rtl" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Additional Notes</FormLabel>
                <FormControl>
                  <VoiceDictationTextarea {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => setLocation("/patients")} data-testid="button-cancel">Cancel</Button>
          <Button type="submit" disabled={createPatient.isPending || updatePatient.isPending} data-testid="button-submit">
            {isEdit ? "Update Record" : "Save Record"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
