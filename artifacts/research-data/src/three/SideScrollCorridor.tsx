import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Box } from "lucide-react";
import type { RecordRow } from "@/lib/records";
import { Button } from "@/components/ui/button";
import { camera } from "./cameraStore";
import { useSideScrollInput } from "./useSideScrollInput";
import { useDragPan } from "./useDragPan";
import { useReducedMotion } from "./useReducedMotion";
import { useDesktopNav } from "@/lib/desktop-nav";
import { useDesktopOptional } from "@/components/desktop/window-store";
import {
  fieldsByRecord,
  inferRecordSeverity,
  recordName,
  type Severity,
} from "./patientFields";
import { STOP_WIDTH, STAGE_PADDING } from "./corridorConfig";
import { PatientStop } from "./PatientStop";
import { ParallaxBackground } from "./ParallaxBackground";
import { SideScrollA11y } from "./SideScrollA11y";
import "./corridor.css";

type Props = {
  records: RecordRow[];
};

function useStageSize(scopeRef: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [scopeRef]);
  return size;
}

export function SideScrollCorridor({ records }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [camX, setCamX] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const size = useStageSize(rootRef);
  const dn = useDesktopNav();
  const desktop = useDesktopOptional();
  const reduced = useReducedMotion();
  const [, wouterNavigate] = useLocation();

  // Compute stop center positions so the active stop is centered in the stage.
  const stopPositions = useMemo(() => {
    const center = size.w / 2;
    return records.map((_, i) => center + (i - 0) * STOP_WIDTH);
  }, [records, size.w]);

  const stopCount = stopPositions.length;
  useEffect(() => {
    camera.setStops(stopPositions);
    if (stopCount > 0) {
      // Keep current index in range; only snap if it's now out of bounds.
      const safe = Math.max(0, Math.min(camera.getCurrentIndex(), stopCount - 1));
      camera.jumpToIndex(safe);
    }
  }, [stopPositions, stopCount]);

  useSideScrollInput({ scopeRef: rootRef });
  useDragPan({ scopeRef: stageRef });
  useEffect(() => camera.setReducedMotion(reduced), [reduced]);

  useEffect(() => {
    return camera.subscribe((x) => {
      setCamX(x);
      setActiveIdx(camera.getCurrentIndex());
    });
  }, []);

  // Deep link via #patient=<id>
  useEffect(() => {
    if (records.length === 0) return;
    const apply = () => {
      const m = window.location.hash.match(/patient=([^&]+)/);
      if (!m) return;
      const id = decodeURIComponent(m[1]);
      const idx = records.findIndex(
        (r) =>
          String(r.id) === id ||
          (typeof r.data?.patientId === "string" && r.data.patientId === id),
      );
      if (idx >= 0) camera.jumpToIndex(idx);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [records]);

  const handleOpen = (r: RecordRow) => {
    if (desktop) {
      dn.open("patient-view", `/patients/${r.id}`);
    } else {
      wouterNavigate(`/patients/${r.id}`);
    }
  };

  const back = () => {
    if (desktop) dn.open("patients", "/patients");
    else wouterNavigate("/patients");
  };

  const trackStyle: CSSProperties = {
    width: stopPositions.length > 0 ? stopPositions[stopPositions.length - 1] + size.w : 0,
    transform: `translate3d(${-camX}px, 0, 0)`,
    height: "100%",
  };

  const activeRecord = records[activeIdx];
  const progress = stopPositions.length <= 1
    ? 0
    : camX <= stopPositions[0]
      ? 0
      : camX >= stopPositions[stopPositions.length - 1]
        ? 1
        : (camX - stopPositions[0]) /
          (stopPositions[stopPositions.length - 1] - stopPositions[0]);

  return (
    <div ref={rootRef} className="ssc-root" role="region" aria-label="Patient side-scroller">
      <ParallaxBackground width={size.w} height={size.h} />
      <SideScrollA11y records={records} />

      <div
        ref={stageRef}
        className="ssc-stage"
        data-active-stop={activeRecord ? `id-${activeRecord.id}` : undefined}
        tabIndex={0}
        aria-label="Use arrow keys to navigate patients, Enter to open in 2D"
      >
        <div ref={trackRef} className="ssc-track" style={trackStyle}>
          {records.map((r, i) => (
            <PatientStop
              key={r.id}
              record={r}
              stopX={stopPositions[i]}
              isActive={i === activeIdx}
              onOpen={handleOpen}
            />
          ))}
        </div>
      </div>

      <div className="ssc-progress" aria-hidden="true">
        <div
          className="ssc-progress-bar"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <div className="ssc-hud">
        <div className="ssc-topbar">
          {desktop ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10"
              onClick={back}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> 2D View
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
              <a href="/patients" onClick={(e) => { e.preventDefault(); back(); }}>
                <ChevronLeft className="h-4 w-4 mr-1" /> 2D View
              </a>
            </Button>
          )}
          <div className="ssc-title">
            Patient Corridor <span className="accent">· 2D Scroll</span>
          </div>
          <div className="ssc-title" style={{ fontSize: 12, opacity: 0.7 }}>
            {records.length === 0 ? "Loading…" : `${activeIdx + 1} / ${records.length}`}
          </div>
        </div>

        {activeRecord && (
          <ActiveCard
            record={activeRecord}
            index={activeIdx}
            total={records.length}
            onOpen={() => handleOpen(activeRecord)}
          />
        )}

        {records.length > 0 && (
          <div className="ssc-minimap" role="tablist" aria-label="Patient navigation">
            {records.map((r, i) => {
              const sev = inferRecordSeverity(r);
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={i === activeIdx}
                  aria-label={`Go to patient ${recordName(r)} (${i + 1} of ${records.length})`}
                  data-active={i === activeIdx}
                  data-severity={sev}
                  className="ssc-minimap-dot"
                  onClick={() => camera.jumpToIndex(i)}
                />
              );
            })}
          </div>
        )}

        <div className="ssc-footer">
          ← → / drag / wheel to scroll · Home / End jumps · Enter opens 2D
        </div>
      </div>
    </div>
  );
}

function ActiveCard({
  record,
  index,
  total,
  onOpen,
}: {
  record: RecordRow;
  index: number;
  total: number;
  onOpen: () => void;
}) {
  const name = recordName(record);
  const id = (typeof record.data?.patientId === "string" && record.data.patientId) || String(record.id);
  const sev: Severity = inferRecordSeverity(record);
  const sevColor: Record<Severity, string> = {
    normal: "var(--ssc-green)",
    warning: "var(--ssc-amber)",
    critical: "var(--ssc-red)",
    unknown: "var(--ssc-ink-dim)",
  };
  return (
    <div className="ssc-active-card">
      <div
        className="ssc-active-portrait"
        style={{ border: `1px solid ${sevColor[sev]}` }}
        aria-hidden="true"
      >
        {name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0]!.toUpperCase())
          .join("")}
      </div>
      <div className="ssc-active-text">
        <span className="ssc-active-name">{name}</span>
        <span className="ssc-active-meta">
          ID {id} · {index + 1} of {total} · {sev}
        </span>
      </div>
      <button
        type="button"
        data-open
        onClick={onOpen}
        className="ssc-open-btn"
        aria-label={`Open record for ${name} in 2D view`}
      >
        Open
      </button>
    </div>
  );
}
