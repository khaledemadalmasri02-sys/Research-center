import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormRow, selectClassName } from "@/components/field-row";
import { Loader2, Upload, X, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { recordsApi, useActiveDefinition } from "@/lib/records";
import { parseVitals, serializeVitals, VITAL_DEFS, type VitalFields } from "@/lib/vitals-utils";
import { uploadImage, imageUrl } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";
import { useNavigationGuard } from "@/hooks/use-unsaved-changes";
import { useRecordDraft } from "@/hooks/use-record-draft";
import { extractIdFromRoute } from "@/lib/route-params";
import { ErrorState } from "@/components/ui/states";
import { motion } from "framer-motion";
import { useInvalidShake } from "@/lib/page-motion";

type Data = Record<string, unknown>;

/** Stable identity for the record being edited; also the draft namespace. */
function draftScope(defId: number | undefined, recordId: number | undefined) {
  return recordId != null ? `record-${recordId}` : `new-${defId ?? "none"}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-lg p-6">
      <h2 className="text-lg font-semibold border-b pb-2 mb-4">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

/** Required clinical fields for a patient record. */
const REQUIRED_FIELDS = ["patientId", "patientName"] as const;

const AGE_MIN = 0;
const AGE_MAX = 130;

export function PatientRecordForm({ definitionId, recordId, guide }: { definitionId?: number; recordId?: number; guide?: React.ReactNode }) {
  const { t } = useTranslation();
  const { data: def } = useActiveDefinition();
  const defId = definitionId ?? def?.id;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: recData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => recordsApi.getRecord(recordId!),
    enabled: !!recordId,
  });

  const initial = (recData?.record.data ?? {}) as Data;
  const [values, setValues] = useState<Data>(() => ({ ...initial }));
  const [vitals, setVitals] = useState<VitalFields>(() => parseVitals(initial.vitalSigns as string));
  const [uploading, setUploading] = useState(false);
  const initialRef = useRef<{ values: Data; vitals: VitalFields } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const valuesRef = useRef<Data>(values);
  const vitalsRef = useRef<VitalFields>(vitals);
  valuesRef.current = values;
  vitalsRef.current = vitals;

  const draftPayload = useMemo(
    () => ({ values, vitals }),
    [values, vitals],
  );
  const draft = useRecordDraft(draftScope(defId, recordId), draftPayload, dirty);

  const guard = useNavigationGuard(dirty);

  useEffect(() => {
    if (recData?.record.data && !initialRef.current) {
      const base = { ...recData.record.data };
      const parsedVitals = parseVitals(base.vitalSigns as string);
      initialRef.current = { values: base, vitals: parsedVitals };
      setDirty(false);

      // Recover an autosaved draft for this exact patient, if one exists.
      const envelope = draft.readDraft();
      if (envelope) {
        const differs =
          JSON.stringify(envelope.data.values) !== JSON.stringify(base) ||
          JSON.stringify(envelope.data.vitals) !== JSON.stringify(parsedVitals);
        if (differs) {
          setValues(envelope.data.values ?? base);
          setVitals(envelope.data.vitals ?? parsedVitals);
          setDirty(true);
          setDraftNotice(envelope.savedAt);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recData]);

  /**
   * Dirty is set explicitly by the setters instead of deep-comparing the whole
   * record with JSON.stringify on every keystroke — the previous version
   * serialised the entire record (including the radiology image array) per
   * character typed.
   */
  const set = useCallback((key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  }, []);

  const setVital = useCallback((key: keyof VitalFields, value: string) => {
    setVitals((v) => ({ ...v, [key]: value }));
    setDirty(true);
  }, []);

  const validate = useCallback((): Record<string, string> => {
    const next: Record<string, string> = {};
    for (const f of REQUIRED_FIELDS) {
      const raw = valuesRef.current[f];
      if (!String(raw ?? "").trim()) {
        next[f] = t("patientForm.requiredField", {
          label: t(`patientForm.f${f === "patientId" ? "PatientId" : "PatientName"}`),
        });
      }
    }
    const ageRaw = String(valuesRef.current.age ?? "").trim();
    if (ageRaw) {
      const age = Number(ageRaw);
      if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) {
        next.age = t("patientForm.invalidAge");
      }
    }
    return next;
  }, [t]);

  const doSave = useMutation({
    mutationFn: async () => {
      const data: Data = { ...valuesRef.current, vitalSigns: serializeVitals(vitalsRef.current) };
      if (recordId) return recordsApi.updateRecord(recordId, data);
      return recordsApi.createRecord(defId!, data);
    },
    onSuccess: () => {
      draft.clearDraft();
      qc.invalidateQueries({ queryKey: ["records", defId] });
      qc.invalidateQueries({ queryKey: ["record", recordId] });
      setDirty(false);
      toast({ title: t("patientForm.saved"), description: t("patientForm.savedBody") });
      navigate(recordId ? `/patients/${recordId}` : "/patients");
    },
    onError: (e) =>
      toast({
        title: t("patientForm.saveFailed"),
        description: (e as Error).message,
        variant: "destructive",
      }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploading) return;
    const found = validate();
    setErrors(found);
    setShowErrors(true);
    if (Object.keys(found).length > 0) {
      // Move focus to the summary so a screen reader reads the failures.
      window.requestAnimationFrame(() => {
        document.getElementById("patient-form-error-summary")?.focus();
      });
      return;
    }
    doSave.mutate();
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const keys: string[] = [];
      for (const f of Array.from(files)) keys.push(await uploadImage(f));
      const cur = Array.isArray(valuesRef.current.radiologyImages)
        ? (valuesRef.current.radiologyImages as string[])
        : [];
      set("radiologyImages", [...cur, ...keys]);
    } catch (err) {
      toast({
        title: t("patientForm.uploadFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const saveDraftNow = useCallback(() => {
    draft.writeDraft({ values: valuesRef.current, vitals: vitalsRef.current });
    toast({ title: t("patientForm.draftSaved"), description: t("patientForm.draftSavedBody") });
  }, [draft, t]);

  if (recordId && isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (recordId && isError) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto">
          <ErrorState
            title={t("common.errorTitle")}
            description={t("patientView.loadFailed")}
            action={
              <Button onClick={() => void refetch()} disabled={isFetching}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  const images = Array.isArray(values.radiologyImages) ? (values.radiologyImages as string[]) : [];
  const errorList = showErrors ? Object.entries(errors) : [];
  const invalidShake = useInvalidShake(errorList.length);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        {guide}
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(recordId ? `/patients/${recordId}` : "/patients")}>
            <ArrowLeft className="h-4 w-4 mr-1 rtl:rotate-180" /> {t("common.back")}
          </Button>
          <h1 className="text-3xl font-bold tracking-tight mt-2">
            {recordId ? t("patientForm.editTitle") : t("patientForm.newTitle")}
          </h1>
        </div>

        {draftNotice && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span>{t("patientForm.draftRestored", { when: new Date(draftNotice).toLocaleString() })}</span>
            <Button size="sm" variant="outline" onClick={saveDraftNow}>
              {t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                draft.clearDraft();
                setDraftNotice(null);
              }}
            >
              {t("patientForm.discardDraft")}
            </Button>
          </div>
        )}

        {errorList.length > 0 && (
          /* The shake lives on this WRAPPER, not on the summary itself: the
           * summary carries `tabIndex={-1}` and receives focus in a rAF right
           * after mount, so putting a changing `key` on it would remount the
           * node out from under that focus call. The wrapper never remounts,
           * so the focus target is stable. */
          <motion.div
            {...(invalidShake ?? {})}
            aria-hidden="true"
            className="motion-reduce:!animate-none"
          >
          <div
            id="patient-form-error-summary"
            tabIndex={-1}
            role="alert"
            className="rounded-md border border-destructive bg-destructive/5 p-4 outline-none"
          >
            <h2 className="font-semibold text-destructive">
              {t("patientForm.errorSummaryTitle", { count: errorList.length })}
            </h2>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
              {errorList.map(([field, message]) => (
                <li key={field}>
                  <a href={`#field-${field}`} className="underline underline-offset-2">
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-6">
            <Section title={t("patientForm.sectionCollection")}>
              <FormRow label={t("patientForm.fCollectionName")}>
                <Input
                  value={(values.collectionName as string) ?? ""}
                  onChange={(e) => set("collectionName", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fCollectionDate")}>
                <Input
                  type="date"
                  value={(values.collectionDate as string) ?? ""}
                  onChange={(e) => set("collectionDate", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fCollectionType")}>
                <select
                  className={selectClassName}
                  value={(values.collectionType as string) ?? ""}
                  onChange={(e) => set("collectionType", e.target.value)}
                >
                  <option value="">{t("patientForm.selectOption")}</option>
                  {["Normal", "Abnormal", "Suspicious"].map((o) => (
                    <option key={o} value={o}>{t(`patients.${o.toLowerCase()}`)}</option>
                  ))}
                </select>
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionPatient")}>
              <div id="field-patientId">
                <FormRow
                  label={t("patientForm.fPatientId")}
                  required
                  markRequired
                  error={showErrors ? errors.patientId : undefined}
                >
                  <Input
                    value={(values.patientId as string) ?? ""}
                    onChange={(e) => set("patientId", e.target.value)}
                  />
                </FormRow>
              </div>
              <div id="field-patientName">
                <FormRow
                  label={t("patientForm.fPatientName")}
                  required
                  markRequired
                  error={showErrors ? errors.patientName : undefined}
                >
                  <Input
                    value={(values.patientName as string) ?? ""}
                    onChange={(e) => set("patientName", e.target.value)}
                  />
                </FormRow>
              </div>
              <div id="field-age">
                <FormRow label={t("patientForm.fAge")} error={showErrors ? errors.age : undefined}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={AGE_MIN}
                    max={AGE_MAX}
                    step={1}
                    value={(values.age as string) ?? ""}
                    onChange={(e) => set("age", e.target.value)}
                  />
                </FormRow>
              </div>
              <FormRow label={t("patientForm.fSex")}>
                <select
                  className={selectClassName}
                  value={(values.sex as string) ?? ""}
                  onChange={(e) => set("sex", e.target.value)}
                >
                  <option value="">{t("patientForm.selectOption")}</option>
                  {["Male", "Female", "Other"].map((o) => (
                    <option key={o} value={o}>{t(`patients.${o.toLowerCase()}`)}</option>
                  ))}
                </select>
              </FormRow>
              <FormRow label={t("patientForm.fDateOfVisit")}>
                <Input
                  type="date"
                  value={(values.dateOfVisit as string) ?? ""}
                  onChange={(e) => set("dateOfVisit", e.target.value)}
                />
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionPresentation")}>
              <FormRow label={t("patientForm.fChiefComplaint")} full>
                <Textarea
                  value={(values.chiefComplaint as string) ?? ""}
                  onChange={(e) => set("chiefComplaint", e.target.value)}
                />
              </FormRow>
              <fieldset className="md:col-span-2">
                <legend className="text-sm font-medium text-muted-foreground">
                  {t("patientForm.fVitals")}
                </legend>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-1">
                  {VITAL_DEFS.map(({ key, label, placeholder, unit }) => (
                    <FormRow
                      key={key}
                      label={`${label} (${unit})`}
                      hint={placeholder}
                      hideLabel
                      controlClassName="mt-0"
                      labelClassName="sr-only"
                    >
                      <Input
                        placeholder={placeholder}
                        inputMode={key === "BP" ? "text" : "decimal"}
                        value={vitals[key]}
                        onChange={(e) => setVital(key, e.target.value)}
                      />
                    </FormRow>
                  ))}
                </div>
              </fieldset>
            </Section>

            <Section title={t("patientForm.sectionTrauma")}>
              <FormRow label={t("patientForm.fHistory")} full>
                <Textarea
                  value={(values.historyTrauma as string) ?? ""}
                  onChange={(e) => set("historyTrauma", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fMechanism")} full>
                <Textarea
                  value={(values.mechanismOfInjuryAndLocalisation as string) ?? ""}
                  onChange={(e) => set("mechanismOfInjuryAndLocalisation", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fSignsTrauma")} full>
                <Textarea
                  value={(values.signsAndSymptomsTrauma as string) ?? ""}
                  onChange={(e) => set("signsAndSymptomsTrauma", e.target.value)}
                />
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionMedical")}>
              <FormRow label={t("patientForm.fHistory")} full>
                <Textarea
                  value={(values.historyMedical as string) ?? ""}
                  onChange={(e) => set("historyMedical", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fSignsMedical")} full>
                <Textarea
                  value={(values.signsAndSymptomsMedical as string) ?? ""}
                  onChange={(e) => set("signsAndSymptomsMedical", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fRiskFactors")} full>
                <Textarea
                  value={(values.riskFactors as string) ?? ""}
                  onChange={(e) => set("riskFactors", e.target.value)}
                />
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionDiagnosis")}>
              <FormRow label={t("patientForm.fProvisional")} full>
                <Textarea
                  value={(values.provisionalDiagnosis as string) ?? ""}
                  onChange={(e) => set("provisionalDiagnosis", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fEmergency")} full>
                <Textarea
                  value={(values.emergencyReport as string) ?? ""}
                  onChange={(e) => set("emergencyReport", e.target.value)}
                />
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionImages")}>
              <FormRow label={t("patientForm.fImages")} full>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {images.map((k) => (
                      <div key={k} className="relative w-24 h-24 rounded-md border overflow-hidden group">
                        <img
                          src={imageUrl(k)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => set("radiologyImages", images.filter((x) => x !== k))}
                          aria-label={t("patientForm.removeImage")}
                          className="absolute top-1 end-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-primary border border-dashed border-input rounded-md px-3 py-2 hover:bg-secondary">
                    <Upload className="h-4 w-4" />
                    {uploading ? t("patientForm.uploading") : t("patientForm.addImage")}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      disabled={uploading}
                      onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    />
                  </label>
                </div>
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionAi")}>
              <FormRow label={t("patientForm.fAiOutput")} full>
                <Textarea
                  value={(values.aiPredictionOutput as string) ?? ""}
                  onChange={(e) => set("aiPredictionOutput", e.target.value)}
                />
              </FormRow>
            </Section>

            <Section title={t("patientForm.sectionFinal")}>
              <FormRow label={t("patientForm.fFinalDiagnosis")} full>
                <Textarea
                  value={(values.finalConfirmedDiagnosis as string) ?? ""}
                  onChange={(e) => set("finalConfirmedDiagnosis", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fFinalDiagnosisAr")} full>
                <Textarea
                  /* Only the Arabic diagnosis field is RTL, and only when it
                   * actually holds Arabic script. */
                  dir={/[\u0600-\u06FF]/.test(String(values.finalConfirmedDiagnosisAr ?? "")) ? "rtl" : "auto"}
                  value={(values.finalConfirmedDiagnosisAr as string) ?? ""}
                  onChange={(e) => set("finalConfirmedDiagnosisAr", e.target.value)}
                />
              </FormRow>
              <FormRow label={t("patientForm.fNotes")} full>
                <Textarea
                  value={(values.notes as string) ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </FormRow>
            </Section>
          </div>

          <div className="flex gap-2 mt-6">
            <Button type="submit" disabled={doSave.isPending || uploading}>
              {doSave.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {doSave.isPending ? t("patientForm.savingRecord") : t("patientForm.saveRecord")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(recordId ? `/patients/${recordId}` : "/patients")}
              disabled={doSave.isPending}
            >
              {t("patientForm.cancel")}
            </Button>
          </div>
        </form>
      </div>

      {/* Three-way unsaved-changes gate: native confirm could not offer a
          "Save draft" escape hatch. */}
      <AlertDialog open={guard.open} onOpenChange={(v) => { if (!v) guard.stay(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("patientForm.unsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("patientForm.unsavedBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={guard.stay}>{t("patientForm.stay")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                saveDraftNow();
                guard.proceed();
              }}
            >
              {t("patientForm.saveDraft")}
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                draft.clearDraft();
                setDirty(false);
                guard.proceed();
              }}
            >
              {t("patientForm.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

export default function PatientRecordFormPage(props: { route?: string }) {
  const { id } = useParams();
  // In the desktop shell there is no wouter <Route>, so fall back to the
  // window `route` prop (e.g. "/patients/133/edit" -> 133).
  const recordId = id ?? extractIdFromRoute(props.route);
  return <PatientRecordForm recordId={recordId ? Number(recordId) : undefined} />;
}