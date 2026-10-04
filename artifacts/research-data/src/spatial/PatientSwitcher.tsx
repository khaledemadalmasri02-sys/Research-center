import type { RecordRow } from "@/lib/records";
import { recordPatientName, textSeverity } from "./spatialSections";

type Props = {
  records: RecordRow[];
  activeId: number | null;
  onPick: (record: RecordRow) => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "•";
}

export function PatientSwitcher({ records, activeId, onPick }: Props) {
  if (records.length === 0) return null;
  return (
    <div className="spc-switcher" role="listbox" aria-label="Switch patient">
      {records.map((r) => {
        const name = recordPatientName(r);
        const sev = textSeverity(
          [
            r.data?.chiefComplaint,
            r.data?.vitalSigns,
            r.data?.provisionalDiagnosis,
            r.data?.finalConfirmedDiagnosis,
          ]
            .map((v) => (typeof v === "string" ? v : ""))
            .join(" "),
        );
        return (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={r.id === activeId}
            data-sev={sev === "muted" ? undefined : sev}
            data-skip-drag
            className="spc-switcher-item spc-focusable"
            title={name}
            onClick={() => onPick(r)}
          >
            {initials(name)}
          </button>
        );
      })}
    </div>
  );
}
