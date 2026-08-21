import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, X, ArrowLeft } from "lucide-react";
import { recordsApi, useActiveDefinition } from "@/lib/records";
import { parseVitals, serializeVitals, VITAL_DEFS, type VitalFields } from "@/lib/vitals-utils";
import { uploadImage, imageUrl } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";

type Data = Record<string, unknown>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-lg p-6">
      <h2 className="text-lg font-semibold border-b pb-2 mb-4">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

function Row({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function PatientRecordForm({ definitionId, recordId, guide }: { definitionId?: number; recordId?: number; guide?: React.ReactNode }) {
  const { data: def } = useActiveDefinition();
  const defId = definitionId ?? def?.id;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: recData, isLoading } = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => recordsApi.getRecord(recordId!),
    enabled: !!recordId,
  });

  const initial = (recData?.record.data ?? {}) as Data;
  const [values, setValues] = useState<Data>(() => ({ ...initial }));
  const [vitals, setVitals] = useState<VitalFields>(() => parseVitals(initial.vitalSigns as string));
  const [uploading, setUploading] = useState(false);

  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const keys: string[] = [];
      for (const f of Array.from(files)) keys.push(await uploadImage(f));
      const cur = Array.isArray(values.radiologyImages) ? (values.radiologyImages as string[]) : [];
      set("radiologyImages", [...cur, ...keys]);
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data: Data = { ...values, vitalSigns: serializeVitals(vitals) };
      if (recordId) return recordsApi.updateRecord(recordId, data);
      return recordsApi.createRecord(defId!, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["records", defId] });
      qc.invalidateQueries({ queryKey: ["record", recordId] });
      toast({ title: "Saved", description: "Patient record saved." });
      navigate(recordId ? `/patients/${recordId}` : "/patients");
    },
    onError: () => toast({ title: "Error", description: "Failed to save record.", variant: "destructive" }),
  });

  if (recordId && isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const images = Array.isArray(values.radiologyImages) ? (values.radiologyImages as string[]) : [];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        {guide}
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(recordId ? `/patients/${recordId}` : "/patients")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{recordId ? "Edit Patient" : "New Patient"}</h1>
        </div>

        <Section title="Collection Info">
          <Row label="Collection Name">
            <Input value={(values.collectionName as string) ?? ""} onChange={(e) => set("collectionName", e.target.value)} />
          </Row>
          <Row label="Date of Collection">
            <Input type="date" value={(values.collectionDate as string) ?? ""} onChange={(e) => set("collectionDate", e.target.value)} />
          </Row>
          <Row label="Type">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={(values.collectionType as string) ?? ""}
              onChange={(e) => set("collectionType", e.target.value)}
            >
              <option value="">— select —</option>
              {["Normal", "Abnormal", "Suspicious"].map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title="Patient Information">
          <Row label="Patient ID">
            <Input value={(values.patientId as string) ?? ""} onChange={(e) => set("patientId", e.target.value)} />
          </Row>
          <Row label="Name">
            <Input value={(values.patientName as string) ?? ""} onChange={(e) => set("patientName", e.target.value)} />
          </Row>
          <Row label="Age">
            <Input type="number" value={(values.age as string) ?? ""} onChange={(e) => set("age", e.target.value)} />
          </Row>
          <Row label="Sex">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={(values.sex as string) ?? ""}
              onChange={(e) => set("sex", e.target.value)}
            >
              <option value="">— select —</option>
              {["Male", "Female", "Other"].map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Row>
          <Row label="Date of Visit">
            <Input type="date" value={(values.dateOfVisit as string) ?? ""} onChange={(e) => set("dateOfVisit", e.target.value)} />
          </Row>
        </Section>

        <Section title="Clinical Presentation">
          <Row label="Chief Complaint" full>
            <Textarea value={(values.chiefComplaint as string) ?? ""} onChange={(e) => set("chiefComplaint", e.target.value)} />
          </Row>
          <Row label="Vital Signs" full>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {VITAL_DEFS.map(({ key, label, placeholder, unit }) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {label} <span className="text-muted-foreground/60">({unit})</span>
                  </Label>
                  <Input
                    placeholder={placeholder}
                    value={vitals[key]}
                    onChange={(e) => setVitals((v) => ({ ...v, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </Row>
        </Section>

        <Section title="Trauma History">
          <Row label="History" full>
            <Textarea value={(values.historyTrauma as string) ?? ""} onChange={(e) => set("historyTrauma", e.target.value)} />
          </Row>
          <Row label="Mechanism of Injury & Localisation" full>
            <Textarea value={(values.mechanismOfInjuryAndLocalisation as string) ?? ""} onChange={(e) => set("mechanismOfInjuryAndLocalisation", e.target.value)} />
          </Row>
          <Row label="Signs & Symptoms (Trauma)" full>
            <Textarea value={(values.signsAndSymptomsTrauma as string) ?? ""} onChange={(e) => set("signsAndSymptomsTrauma", e.target.value)} />
          </Row>
        </Section>

        <Section title="Medical History">
          <Row label="History" full>
            <Textarea value={(values.historyMedical as string) ?? ""} onChange={(e) => set("historyMedical", e.target.value)} />
          </Row>
          <Row label="Signs & Symptoms (Medical)" full>
            <Textarea value={(values.signsAndSymptomsMedical as string) ?? ""} onChange={(e) => set("signsAndSymptomsMedical", e.target.value)} />
          </Row>
          <Row label="Risk Factors" full>
            <Textarea value={(values.riskFactors as string) ?? ""} onChange={(e) => set("riskFactors", e.target.value)} />
          </Row>
        </Section>

        <Section title="Diagnosis & Findings">
          <Row label="Provisional Diagnosis" full>
            <Textarea value={(values.provisionalDiagnosis as string) ?? ""} onChange={(e) => set("provisionalDiagnosis", e.target.value)} />
          </Row>
          <Row label="Emergency Report" full>
            <Textarea value={(values.emergencyReport as string) ?? ""} onChange={(e) => set("emergencyReport", e.target.value)} />
          </Row>
        </Section>

        <Section title="Radiology Images">
          <Row label="Images" full>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {images.map((k) => (
                  <div key={k} className="relative w-24 h-24 rounded-md border overflow-hidden group">
                    <img src={imageUrl(k)} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => set("radiologyImages", images.filter((x) => x !== k))}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-primary border border-dashed border-input rounded-md px-3 py-2 hover:bg-secondary">
                <Upload className="h-4 w-4" />
                {uploading ? "Uploading…" : "Add image"}
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
              </label>
            </div>
          </Row>
        </Section>

        <Section title="AI Prediction">
          <Row label="AI Prediction Output" full>
            <Textarea value={(values.aiPredictionOutput as string) ?? ""} onChange={(e) => set("aiPredictionOutput", e.target.value)} />
          </Row>
        </Section>

        <Section title="Final Diagnosis">
          <Row label="Final Confirmed Diagnosis" full>
            <Textarea value={(values.finalConfirmedDiagnosis as string) ?? ""} onChange={(e) => set("finalConfirmedDiagnosis", e.target.value)} />
          </Row>
          <Row label="Final Confirmed Diagnosis (د عزمي)" full>
            <Textarea dir="rtl" value={(values.finalConfirmedDiagnosisAr as string) ?? ""} onChange={(e) => set("finalConfirmedDiagnosisAr", e.target.value)} />
          </Row>
          <Row label="Notes" full>
            <Textarea value={(values.notes as string) ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Row>
        </Section>

        <div className="flex gap-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || uploading}>
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saveMutation.isPending ? "Saving…" : "Save record"}
          </Button>
          <Button variant="outline" onClick={() => navigate(recordId ? `/patients/${recordId}` : "/patients")} disabled={saveMutation.isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </Layout>
  );
}

export default function PatientRecordFormPage() {
  const { id } = useParams();
  return <PatientRecordForm recordId={id ? Number(id) : undefined} />;
}
