import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { RecordRow } from "@/lib/records";
import {
  fieldsByRecord,
  inferRecordSeverity,
  recordName,
  SEVERITY_BG,
  SEVERITY_COLORS,
  type FieldGroup,
  type SpatialField,
} from "./patientFields";
import {
  CARD_WIDTH,
  CARDS_PER_STOP,
  type DepthLane,
  type LayoutCard,
} from "./corridorConfig";
import { EcgCanvas } from "./EcgCanvas";

type Props = {
  record: RecordRow;
  stopX: number; // center x of this stop
  isActive: boolean;
  onOpen: (record: RecordRow) => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const LAYOUTS: Record<FieldGroup, { x: number; y: number; depth: DepthLane; scale: number }> = {
  identity: { x: 0, y: 240, depth: "near", scale: 1 },
  vitals: { x: -360, y: 80, depth: "mid", scale: 0.94 },
  diagnosis: { x: 360, y: 80, depth: "mid", scale: 0.94 },
  imaging: { x: 0, y: 540, depth: "far", scale: 0.85 },
  labs: { x: -360, y: 360, depth: "far", scale: 0.85 },
  notes: { x: 360, y: 360, depth: "far", scale: 0.85 },
};

function FieldRow({ field }: { field: SpatialField }) {
  const sev = field.severity ?? "unknown";
  return (
    <div className="ssc-row">
      <span className="ssc-label">{field.label}</span>
      <span className={`ssc-value sev-${sev}`}>{field.value}</span>
    </div>
  );
}

function CardInner({
  fields,
  title,
  layout,
  active,
  severity,
}: {
  fields: SpatialField[];
  title: string;
  layout: (typeof LAYOUTS)[FieldGroup];
  active: boolean;
  severity: "normal" | "warning" | "critical" | "unknown";
}) {
  if (fields.length === 0) return null;
  const style: CSSProperties = {
    position: "absolute",
    left: layout.x,
    top: layout.y,
    width: CARD_WIDTH,
    transform: `translate(-50%, 0) scale(${layout.scale * (active ? 1.04 : 1)})`,
    transformOrigin: "center center",
    zIndex: layout.depth === "near" ? 5 : layout.depth === "mid" ? 4 : 3,
    borderColor: SEVERITY_COLORS[severity],
    background: `linear-gradient(180deg, ${SEVERITY_BG[severity]} 0%, var(--ssc-card) 70%)`,
  };
  return (
    <div className="ssc-card ssc-card-focusable" data-card data-depth={layout.depth} style={style}>
      <h3 className="ssc-card-title">{title}</h3>
      {fields.slice(0, 6).map((f, i) => (
        <FieldRow key={`${title}-${i}`} field={f} />
      ))}
      {fields.length > 6 && (
        <div className="ssc-row">
          <span className="ssc-label">+{fields.length - 6} more</span>
          <span className="ssc-value">scrollable below</span>
        </div>
      )}
    </div>
  );
}

function PatientStopInner({ record, stopX, isActive, onOpen }: Props) {
  const grouped = useMemo(() => fieldsByRecord(record), [record]);
  const severity = inferRecordSeverity(record);
  const name = useMemo(() => recordName(record), [record]);
  const idStr =
    (typeof record.data?.patientId === "string" && record.data.patientId) ||
    String(record.id);
  const [hover, setHover] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 400);
    return () => clearTimeout(t);
  }, [isActive]);

  const stopStyle: CSSProperties = {
    transform: `translate3d(${stopX}px, 0, 0)`,
    width: 0,
  };

  const wrapperCls = `ssc-stop ${isActive ? "ssc-stop-active" : ""}`;
  const glow = isActive || hover;
  const ringColor = SEVERITY_COLORS[severity];

  return (
    <div className={wrapperCls} style={stopStyle} data-depth="near" data-stop-id={record.id}>
      <div
        className="ssc-pedestal"
        style={{ borderColor: ringColor, boxShadow: `0 -8px 30px -8px ${ringColor}` }}
      >
        <div className="ssc-pedestal-label" style={{ color: ringColor }}>
          {idStr}
        </div>
      </div>

      <div
        className="ssc-portrait"
        style={{
          position: "absolute",
          left: 0,
          top: 80,
          transform: `translate(-50%, 0) scale(${glow ? 1.08 : 1})`,
          borderColor: ringColor,
          background: `radial-gradient(circle at 30% 30%, var(--ssc-cyan-2), var(--ssc-bg-2) 70%)`,
          boxShadow: `0 0 0 4px ${SEVERITY_BG[severity]}, 0 0 ${glow ? 32 : 16}px ${ringColor}`,
        }}
        aria-hidden="true"
      >
        {initials(name)}
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 200,
          width: 320,
          transform: "translateX(-50%)",
          textAlign: "center",
        }}
      >
        <div className="ssc-name" style={{ color: flash ? ringColor : "var(--ssc-ink)" }}>
          {name}
        </div>
        <div className="ssc-id">ID: {idStr}</div>
        <button
          type="button"
          data-open
          data-card
          onClick={() => onOpen(record)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          className="ssc-open-btn"
          style={{ marginTop: 8, position: "static", transform: "none" }}
          aria-label={`Open record for ${name} in 2D view`}
        >
          Open in 2D
        </button>
      </div>

      <Card
        title="Identity"
        fields={grouped.identity}
        layout={LAYOUTS.identity}
        active={isActive}
        severity={severity}
      />
      <Card
        title="Vitals"
        fields={grouped.vitals}
        layout={LAYOUTS.vitals}
        active={isActive}
        severity={severity}
      />
      <Card
        title="Diagnosis"
        fields={grouped.diagnosis}
        layout={LAYOUTS.diagnosis}
        active={isActive}
        severity={severity}
      />
      <Card
        title="Imaging"
        fields={grouped.imaging}
        layout={LAYOUTS.imaging}
        active={isActive}
        severity={severity}
      />
      <Card
        title="Labs / AI"
        fields={grouped.labs}
        layout={LAYOUTS.labs}
        active={isActive}
        severity={severity}
      />
      <Card
        title="Notes"
        fields={grouped.notes}
        layout={LAYOUTS.notes}
        active={isActive}
        severity={severity}
      />

      {/* Vitals ECG strip layered above the vitals card */}
      {grouped.vitals.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: LAYOUTS.vitals.x,
            top: LAYOUTS.vitals.y - 120,
            width: CARD_WIDTH,
            transform: `translate(-50%, 0) scale(${LAYOUTS.vitals.scale * (isActive ? 1.04 : 1)})`,
            transformOrigin: "center center",
            zIndex: 4,
            borderRadius: 14,
            border: "1px solid var(--ssc-card-border)",
            background: "rgba(8, 24, 38, 0.78)",
            padding: 6,
            boxShadow: "var(--ssc-card-glow)",
          }}
          aria-hidden="true"
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ssc-cyan)",
              padding: "0 6px 4px",
            }}
          >
            Live ECG
          </div>
          <EcgCanvas width={CARD_WIDTH - 12} height={84} />
        </div>
      )}

      <span data-stop-marker style={{ display: "none" }}>{record.id}</span>
    </div>
  );
}

const Card = memo(CardInner, (prev, next) => {
  return (
    prev.active === next.active &&
    prev.severity === next.severity &&
    prev.title === next.title &&
    prev.layout === next.layout &&
    prev.fields === next.fields
  );
});
export const PatientStop = memo(PatientStopInner, (prev, next) => {
  if (prev.isActive !== next.isActive) return false;
  if (prev.stopX !== next.stopX) return false;
  if (prev.onOpen !== next.onOpen) return false;
  return prev.record === next.record;
});

// (CARDS_PER_STOP retained for backwards compat with potential future
// dynamic layout; the spatial arrangement lives in LAYOUTS above.)
void CARDS_PER_STOP;
