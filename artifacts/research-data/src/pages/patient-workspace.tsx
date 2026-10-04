import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Box } from "lucide-react";
import { Layout } from "@/components/layout";
import { recordsApi, PATIENTS_DEFINITION_NAME, type RecordRow } from "@/lib/records";
import { SpatialWorkspace, SpatialWorkspaceWithFetch } from "@/spatial/SpatialWorkspace";
import { useDesktopOptional } from "@/components/desktop/window-store";

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

export default function PatientWorkspacePage(props: { route?: string; windowId?: string }) {
  const { t } = useTranslation();
  // In the desktop shell, each window has its own `route` prop. In the classic
  // web shell, we read the id from the document URL via wouter.
  const desktopRouteId = props.route?.match(/\/patients\/spatial\/(\d+)/)?.[1];
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const desktop = useDesktopOptional();
  const idFromUrl = params.id ? Number(params.id) : undefined;
  const initialId = idFromUrl ?? (desktopRouteId ? Number(desktopRouteId) : undefined);
  const [activeId, setActiveId] = useState<number | undefined>(initialId);
  // Keep activeId in sync when the URL or desktop route changes.
  useEffect(() => {
    setActiveId(initialId);
  }, [initialId]);
  const [webgl, setWebgl] = useState(true);
  useEffect(() => setWebgl(detectWebGL()), []);

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

  // No id → patient picker; redirect to first record if available.
  useEffect(() => {
    if (activeId) return;
    if (!records || records.length === 0) return;
    const firstId = records[0].id;
    setActiveId(firstId);
    if (!params.id && !desktopRouteId) {
      navigate(`/patients/spatial/${firstId}`, { replace: true });
    }
  }, [activeId, records, navigate, params.id, desktopRouteId]);

  if (!webgl) {
    return (
      <div
        className="relative w-full h-full min-h-[480px] grid place-items-center p-6 text-center text-white"
        style={{ background: "#03110d" }}
      >
        <div className="max-w-md space-y-3">
          <Box className="h-10 w-10 mx-auto text-emerald-300" />
          <h2 className="text-xl font-semibold">{t("workspace.needsModernBrowser")}</h2>
          <p className="text-sm text-white/70">{t("workspace.needsModernBrowserBody")}</p>
        </div>
      </div>
    );
  }

  if (isLoading || patientsDefId == null) {
    return (
      <div
        className="relative w-full h-full min-h-[480px] grid place-items-center text-white text-sm"
        style={{ background: "#03110d" }}
      >
        Loading patients…
      </div>
    );
  }
  if (isError) {
    return (
      <div
        className="relative w-full h-full min-h-[480px] grid place-items-center text-white text-sm"
        style={{ background: "#03110d" }}
      >
        Error loading patients: {(error as Error | null)?.message ?? "unknown"}
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div
        className="relative w-full h-full min-h-[480px] grid place-items-center text-white/70 text-sm"
        style={{ background: "#03110d" }}
      >
        No patients yet — add one from the 2D list.
      </div>
    );
  }

  const id = activeId ?? records[0]?.id;
  if (!id) {
    return (
      <div
        className="relative w-full h-full min-h-[480px] grid place-items-center text-white/70 text-sm"
        style={{ background: "#03110d" }}
      >
        No patients yet — add one from the 2D list.
      </div>
    );
  }
  return (
    <Layout>
      <h1 className="sr-only">{t("app.patientWorkspace")}</h1>
      <div
        className="relative w-full h-full min-h-[480px] text-white overflow-hidden"
        style={{ position: "relative" }}
      >
        <SpatialWorkspaceWithFetch
        recordId={id}
        fallbackRecords={records}
        onSelectPatient={(r) => {
          if (desktop && props.windowId) {
            desktop.setRoute(props.windowId, `/patients/spatial/${r.id}`);
          } else {
            navigate(`/patients/spatial/${r.id}`);
          }
          setActiveId(r.id);
        }}
      />
    </div>
    </Layout>
  );
}

// Re-export the basic workspace for callers that already have a record.
export { SpatialWorkspace };