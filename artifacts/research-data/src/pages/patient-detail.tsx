import { Layout } from "@/components/layout";
import { useGetPatient, getGetPatientQueryKey, useDeletePatient, getListPatientsQueryKey, getGetPatientStatsQueryKey, useListPatients } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, Printer, ArrowLeft, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useMemo } from "react";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { parseVitals, VITAL_DEFS } from "@/lib/vitals-utils";

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
            <span className="text-sm font-medium">{vitals[key]} <span className="text-xs text-muted-foreground">{unit}</span></span>
          </div>
        ) : null
      )}
    </div>
  );
}

function Field({ label, value, rtl }: { label: string; value: string | number | null | undefined; rtl?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm" dir={rtl ? "rtl" : undefined}>{value}</div>
    </div>
  );
}

function parsePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return raw ? [raw] : []; }
}

function RadiologyGallery({ patient }: { patient: any }) {
  // Collect images: new multi-image field takes priority, fall back to old single field
  const multiPaths = parsePaths(patient.radiologyImages);
  const legacyPath = patient.radiologyImageFilePathOrLink as string | null | undefined;

  const allPaths: string[] = multiPaths.length > 0
    ? multiPaths
    : legacyPath ? [legacyPath] : [];

  if (allPaths.length === 0) return null;

  const toSrc = (p: string) =>
    p.startsWith("/objects/") ? `/api/storage${p}` : p;

  return (
    <div className="bg-card border rounded-lg p-6">
      <h2 className="text-lg font-semibold border-b pb-2 mb-4">
        Radiology Images <span className="text-muted-foreground font-normal text-sm">({allPaths.length})</span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {allPaths.map((p, idx) => (
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
              data-testid={idx === 0 ? "img-radiology-detail" : undefined}
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

export default function PatientDetail() {
  const { id } = useParams();
  const patientId = Number(id);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const listContext = useMemo(() => {
    const queryStart = location.indexOf("?");
    const params = new URLSearchParams(queryStart >= 0 ? location.slice(queryStart + 1) : "");
    return {
      search: params.get("search") ?? "",
      sex: params.get("sex") ?? "all",
      collectionType: params.get("collectionType") ?? "all",
      sortKey: params.get("sortKey") ?? "createdAt",
      sortDir: params.get("sortDir") === "asc" ? "asc" as const : "desc" as const,
    };
  }, [location]);
  
  const { data: patient, isLoading } = useGetPatient(patientId, {
    query: { enabled: !!patientId, queryKey: getGetPatientQueryKey(patientId) }
  });

  const { data: navigationData, isLoading: isNavigationLoading } = useListPatients({
    search: listContext.search || undefined,
    sex: listContext.sex !== "all" ? listContext.sex : undefined,
    collectionType: listContext.collectionType !== "all" ? listContext.collectionType : undefined,
    limit: 1000,
  });

  const navigationPatients = useMemo(() => {
    const list = navigationData?.patients ?? [];
    return [...list].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[listContext.sortKey];
      const bv = (b as unknown as Record<string, unknown>)[listContext.sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return listContext.sortDir === "asc" ? cmp : -cmp;
    });
  }, [navigationData, listContext.sortKey, listContext.sortDir]);

  const currentIndex = navigationPatients.findIndex((p) => p.id === patientId);
  const previousPatient = currentIndex > 0 ? navigationPatients[currentIndex - 1] : undefined;
  const nextPatient =
    currentIndex >= 0 && currentIndex < navigationPatients.length - 1
      ? navigationPatients[currentIndex + 1]
      : undefined;

  function detailHref(nextId: number): string {
    const params = new URLSearchParams();
    if (listContext.search) params.set("search", listContext.search);
    if (listContext.sex !== "all") params.set("sex", listContext.sex);
    if (listContext.collectionType !== "all") params.set("collectionType", listContext.collectionType);
    params.set("sortKey", listContext.sortKey);
    params.set("sortDir", listContext.sortDir);
    return `/patients/${nextId}?${params.toString()}`;
  }

  const deletePatient = useDeletePatient();

  const handleDelete = async () => {
    try {
      await deletePatient.mutateAsync({ id: patientId });
      toast({ title: "Success", description: "Patient record deleted." });
      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPatientStatsQueryKey() });
      setLocation("/patients");
    } catch (e) {
      toast({ title: "Error", description: "Failed to delete record.", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Patient Record</h1>
            <p className="text-muted-foreground mt-1">{patient?.patientId}</p>
          </div>
          
          {patient && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="w-4 h-4 mr-2" /> Print
              </Button>
              <Button variant="outline" onClick={() => setLocation(`/patients/${patient.id}/edit`)}>
                <Edit className="w-4 h-4 mr-2" /> Edit
              </Button>
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
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

          <div className="flex items-center justify-between gap-3 border-y py-3">
            <Button
              variant="outline"
              onClick={() => previousPatient && setLocation(detailHref(previousPatient.id))}
              disabled={isNavigationLoading || !previousPatient}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground text-center">
              {currentIndex >= 0
                ? `${currentIndex + 1} of ${navigationPatients.length}`
                : isNavigationLoading
                ? "Loading list…"
                : "Not in current list"}
            </span>
            <Button
              variant="outline"
              onClick={() => nextPatient && setLocation(detailHref(nextPatient.id))}
              disabled={isNavigationLoading || !nextPatient}
            >
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

        {isLoading ? (
          <div className="space-y-8">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : patient ? (
          <div className="space-y-6">
            {(patient as any).collectionName || (patient as any).collectionDate || (patient as any).collectionType ? (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold border-b border-teal-200 pb-2 mb-4 text-teal-800">Collection Info</h2>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Collection Name" value={(patient as any).collectionName} />
                  <Field label="Date of Collection" value={(() => { try { const d = new Date((patient as any).collectionDate ?? ""); return (patient as any).collectionDate && !isNaN(d.getTime()) ? format(d, "MMM d, yyyy") : ((patient as any).collectionDate || null); } catch { return (patient as any).collectionDate || null; } })()} />
                  {(patient as any).collectionType && (
                    <div className="mb-4">
                      <div className="text-sm font-medium text-muted-foreground">Type</div>
                      <div className="mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          (patient as any).collectionType === "Normal"
                            ? "bg-green-100 text-green-800"
                            : (patient as any).collectionType === "Abnormal"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}>
                          {(patient as any).collectionType}
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
                <Field label="Patient ID" value={patient.patientId} />
                <Field label="Name" value={patient.patientName} />
                <Field label="Age" value={patient.age} />
                <Field label="Sex" value={patient.sex} />
                <Field label="Date of Visit" value={(() => { try { const d = new Date(patient.dateOfVisit ?? ""); return patient.dateOfVisit && !isNaN(d.getTime()) ? format(d, "MMM d, yyyy") : (patient.dateOfVisit || null); } catch { return patient.dateOfVisit || null; } })()} />
              </div>
            </div>

            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Clinical Presentation</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Chief Complaint" value={patient.chiefComplaint} />
                <div className="mb-4">
                  <div className="text-sm font-medium text-muted-foreground mb-1">Vital Signs</div>
                  <VitalsDisplay value={patient.vitalSigns} />
                </div>
              </div>
            </div>

            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Trauma History</h2>
              <Field label="History" value={patient.historyTrauma} />
              <Field label="Mechanism of Injury & Localisation" value={patient.mechanismOfInjuryAndLocalisation} />
              <Field label="Signs & Symptoms" value={patient.signsAndSymptomsTrauma} />
            </div>

            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Medical History</h2>
              <Field label="History" value={patient.historyMedical} />
              <Field label="Signs & Symptoms" value={patient.signsAndSymptomsMedical} />
              <Field label="Risk Factors" value={patient.riskFactors} />
            </div>

            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Diagnosis & Findings</h2>
              <Field label="Provisional Diagnosis" value={patient.provisionalDiagnosis} />
              <Field label="Emergency Report" value={patient.emergencyReport} />
            </div>

            <RadiologyGallery patient={patient} />

            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">AI Prediction</h2>
              <Field label="AI Prediction Output" value={patient.aiPredictionOutput} />
            </div>

            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-lg font-semibold border-b pb-2 mb-4">Final Diagnosis</h2>
              <Field label="Final Confirmed Diagnosis" value={patient.finalConfirmedDiagnosis} />
              <Field label="Final Confirmed Diagnosis (د عزمي)" value={patient.finalConfirmedDiagnosisAr} rtl />
              <Field label="Notes" value={patient.notes} />
            </div>
          </div>
        ) : (
          <div>Patient not found.</div>
        )}
      </div>
    </Layout>
  );
}
