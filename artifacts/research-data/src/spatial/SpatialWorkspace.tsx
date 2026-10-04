import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordsApi, PATIENTS_DEFINITION_NAME, type RecordRow, type RecordDefinition } from "@/lib/records";
import { useQuery } from "@tanstack/react-query";
import { camera, SPATIAL_X_SPACING } from "./spatialCamera";
import { useSpatialGestures } from "./useSpatialGestures";
import { useReducedMotion } from "./useReducedMotion";
import { useDesktopNav } from "@/lib/desktop-nav";
import { useDesktopOptional } from "@/components/desktop/window-store";
import { buildSpatialSections, recordPatientName, recordPatientSubtitle } from "./spatialSections";
import type { SpatialField, SpatialSection } from "./spatialTypes";
import { SectionPanel } from "./SectionPanel";
import { HorizontalSectionNav } from "./HorizontalSectionNav";
import { PatientSwitcher } from "./PatientSwitcher";
import { SpatialA11y } from "./SpatialA11y";
import { SpatialFocusMode } from "./SpatialFocusMode";
import { SpatialEnvironment } from "./SpatialEnvironment";
import "./spatial.css";

function useStageSize(scopeRef: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [scopeRef]);
  return size;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="spc-empty" role="status">
      {message}
    </div>
  );
}

export function SpatialWorkspace({
  record,
  allRecords,
  definition,
  onSelectPatient,
}: {
  record: RecordRow | null;
  allRecords: RecordRow[];
  definition?: RecordDefinition | null;
  onSelectPatient?: (record: RecordRow) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const size = useStageSize(rootRef);
  const reduced = useReducedMotion();
  const dn = useDesktopNav();
  const desktop = useDesktopOptional();
  const [, wouterNavigate] = useLocation();

  const sections = useMemo<SpatialSection[]>(
    () => (record ? buildSpatialSections(record, { definition }) : []),
    [record, definition],
  );
  const fieldCounts = useMemo(() => sections.map((s) => s.fields.length), [sections]);

  // Mirror the camera store into React at most ~30 Hz for the HUD (active
  // section name, progress bar, switcher highlighting). The world/track
  // transforms are updated at 60 Hz via a direct ref + RAF below, bypassing
  // React reconciliation entirely.
  const [sectionIndex, setSectionIndex] = useState(0);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusField, setFocusField] = useState<SpatialField | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    camera.configure(sections.length, fieldCounts);
    camera.setSection(0);
    setSectionIndex(0);
    setFieldIndex(0);
  }, [sections, fieldCounts]);

  useEffect(() => {
    let raf = 0;
    let lastEmit = 0;
    let lastX = -1;
    let lastProgress = -1;
    const loop = (t: number) => {
      // 60 Hz direct DOM writes for camera transform & progress bar
      const x = camera.getX();
      if (x !== lastX && trackRef.current) {
        lastX = x;
        const s = sizeRef.current;
        trackRef.current.style.transform = `translate3d(${-x + s.w / 2}px, 0, 0)`;
      }
      const p = camera.progress();
      if (Math.abs(p - lastProgress) > 0.001 && progressRef.current) {
        lastProgress = p;
        progressRef.current.style.transform = `scaleX(${p})`;
      }
      // 30 Hz React state for HUD chrome
      if (t - lastEmit > 33) {
        lastEmit = t;
        setSectionIndex(camera.getSectionIndex());
        setFieldIndex(camera.getFieldIndex());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useSpatialGestures({ scopeRef: rootRef });
  useEffect(() => camera.setReducedMotion(reduced), [reduced]);

  // Esc closes focus mode
  useEffect(() => {
    if (!focusOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setFocusOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusOpen]);

  const onBack = () => {
    if (desktop) dn.open("patients", "/patients");
    else wouterNavigate("/patients");
  };
  const onOpen2D = () => {
    if (!record) return;
    if (desktop) dn.open("patient-view", `/patients/${record.id}`);
    else wouterNavigate(`/patients/${record.id}`);
  };
  const onPickPatient = (r: RecordRow) => {
    if (onSelectPatient) {
      onSelectPatient(r);
      return;
    }
    wouterNavigate(`/patients/spatial/${r.id}`);
  };
  const onFocusField = useCallback(
    (i: number) => {
      camera.setField(i);
      const sec = sections[camera.getSectionIndex()];
      const f = sec?.fields[i];
      if (f) {
        setFocusField(f);
        setFocusOpen(true);
      }
    },
    [sections],
  );

  // Render only the active section ± 2 (idle culling). When user navigates
  // close to the edge, expand the window. This keeps the DOM tiny even with
  // hundreds of fields per section.
  const RADIUS = 2;
  const minIdx = Math.max(0, sectionIndex - RADIUS);
  const maxIdx = Math.min(sections.length - 1, sectionIndex + RADIUS);
  // Expand one slot when within 1 of the edge so transitions stay smooth.
  const expandedMin = sectionIndex - RADIUS <= 1 ? 0 : minIdx;
  const expandedMax =
    sectionIndex + RADIUS >= sections.length - 2 ? sections.length - 1 : maxIdx;

  const activeSection = sections[sectionIndex] ?? null;
  const activeField = activeSection?.fields[fieldIndex] ?? null;

  // The track is the size of the world. We render only the visible slice
  // (active ± 2) but the track itself is full-width so the cull window can
  // shift smoothly without re-laying out the container.
  const trackWidth = Math.max(sections.length, 1) * SPATIAL_X_SPACING;

  return (
    <div
      ref={rootRef}
      className="spc-root"
      role="application"
      aria-roledescription="spatial patient record workspace"
      aria-label={
        record ? `Spatial record for ${recordPatientName(record)}` : "Spatial record workspace"
      }
    >
      <SpatialEnvironment
        width={size.w}
        height={size.h}
        xProgress={camera.progress() * 2 - 1}
        paused={reduced}
      />
      <SpatialA11y sections={sections} patientName={record ? recordPatientName(record) : ""} />

      <div className="spc-world">
        <div ref={trackRef} className="spc-track" style={{ width: trackWidth }}>
          {sections.slice(expandedMin, expandedMax + 1).map((s, idx) => {
            const i = expandedMin + idx;
            const isActive = i === sectionIndex;
            return (
              <SectionPanel
                key={s.id}
                section={s}
                sectionIndex={i}
                activeSectionIndex={sectionIndex}
                fieldIndex={isActive ? fieldIndex : -1}
                reducedMotion={reduced}
                onFocusField={onFocusField}
              />
            );
          })}
        </div>
      </div>

      <div className="spc-hud">
        <div className="spc-topbar">
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10"
            onClick={onBack}
            data-skip-drag
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> 2D View
          </Button>
          <div className="spc-brand">
            <span className="dot" />
            ResCenter <span className="accent">Spatial</span>
          </div>
          {record ? (
            <div style={{ textAlign: "right", lineHeight: 1.2 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{recordPatientName(record)}</div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--spc-ink-faint)",
                }}
              >
                {recordPatientSubtitle(record)} · {sections.length} sections · {sections.reduce((n, s) => n + s.fields.length, 0)} fields
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--spc-ink-faint)" }}>—</div>
          )}
        </div>

        {sections.length > 0 && (
          <HorizontalSectionNav
            sections={sections}
            activeIndex={sectionIndex}
            onPick={(i) => camera.setSection(i)}
          />
        )}

        {allRecords.length > 0 && record && (
          <PatientSwitcher
            records={allRecords}
            activeId={record.id}
            onPick={onPickPatient}
          />
        )}

        {sections.length > 0 && (
          <div className="spc-progress" aria-hidden="true">
            <div ref={progressRef} className="spc-progress-bar" />
          </div>
        )}

        <div className="spc-footer">
          ← → sections · ↑ ↓ fields · drag · Shift+wheel · Home / End · Enter to focus · Esc to close
        </div>
      </div>

      <SpatialFocusMode
        open={focusOpen}
        section={activeSection}
        field={focusField}
        patientName={record ? recordPatientName(record) : ""}
        onClose={() => setFocusOpen(false)}
        onOpen2D={onOpen2D}
      />
    </div>
  );
}

type WorkspaceWithFetchProps = {
  recordId: number;
  fallbackRecords: RecordRow[];
  onSelectPatient?: (record: RecordRow) => void;
};

export function SpatialWorkspaceWithFetch({
  recordId,
  fallbackRecords,
  onSelectPatient,
}: WorkspaceWithFetchProps) {
  const { data: recData, isLoading } = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => recordsApi.getRecord(recordId),
    enabled: !!recordId,
  });
  const record = recData?.record ?? fallbackRecords.find((r) => r.id === recordId) ?? null;

  // Prefer the definition returned alongside the record; fall back to a
  // dedicated request only if the bundled definition is missing.
  const bundledDefinition = recData?.definition ?? null;
  const defId = record?.definitionId;
  const { data: defData } = useQuery({
    queryKey: ["record-definition", defId],
    queryFn: () => (defId ? recordsApi.getDefinition(defId) : Promise.resolve(null)),
    enabled: !!defId && !bundledDefinition,
  });
  const definition = bundledDefinition ?? defData?.definition ?? null;

  if (!record) return <EmptyState message="Patient not found." />;
  if (isLoading && !recData) return <EmptyState message="Loading patient…" />;
  return (
    <SpatialWorkspace
      record={record}
      allRecords={fallbackRecords}
      definition={definition}
      onSelectPatient={onSelectPatient}
    />
  );
}
