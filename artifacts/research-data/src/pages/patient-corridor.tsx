import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Box } from "lucide-react";
import { Layout } from "@/components/layout";
import { recordsApi, PATIENTS_DEFINITION_NAME, type RecordRow } from "@/lib/records";
import { SideScrollCorridor } from "@/three/SideScrollCorridor";

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="absolute inset-0 grid place-items-center text-white/70 text-sm"
      role="status"
    >
      {message}
    </div>
  );
}

export default function PatientCorridorPage() {
  const { t } = useTranslation();
  const { data: defs } = useQuery({
    queryKey: ["records", "definitions", "list"],
    queryFn: () => recordsApi.listDefinitions(),
  });

  const patientsDefId = useMemo(
    () => defs?.definitions.find((d) => d.name === PATIENTS_DEFINITION_NAME)?.id,
    [defs],
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["records", patientsDefId, "directory"],
    queryFn: () => recordsApi.listRecords(patientsDefId!),
    enabled: patientsDefId != null,
  });

  const records = useMemo<RecordRow[]>(
    () =>
      (data?.records ?? [])
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [data],
  );

  const [webgl, setWebgl] = useState(true);
  useEffect(() => {
    setWebgl(detectWebGL());
  }, []);

  // Wrap in <Layout>: /patients/vr used to render with no sidebar, no <h1>
  // and no #main-content, so the skip link pointed at a nonexistent element.
  // <Layout> early-returns a bare <main> in desktop mode, so the desktop
  // window chrome is unaffected.
  return (
    <Layout>
      <h1 className="sr-only">{t("app.patientCorridor")}</h1>
      <div
        className="relative w-full h-full min-h-[480px] bg-[#04101a] text-white overflow-hidden"
        style={{ position: "relative" }}
      >
      {!webgl ? (
        <div className="grid place-items-center h-full p-6 text-center">
          <div className="max-w-md space-y-3">
            <Box className="h-10 w-10 mx-auto text-cyan-300" />
            <h2 className="text-xl font-semibold">{t("corridor.needsModernBrowser")}</h2>
            <p className="text-sm text-white/70">{t("corridor.needsModernBrowserBody")}</p>
          </div>
        </div>
      ) : isLoading || patientsDefId == null ? (
        <EmptyState message="Loading patients…" />
      ) : isError ? (
        <EmptyState
          message={`Error loading patients: ${(error as Error | null)?.message ?? "unknown"}`}
        />
      ) : records.length === 0 ? (
        <EmptyState message="No patients yet — add one from the 2D list." />
      ) : (
        <SideScrollCorridor records={records} />
      )}
      </div>
    </Layout>
  );
}
