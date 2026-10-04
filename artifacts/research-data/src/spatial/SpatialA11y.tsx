import { memo } from "react";
import type { SpatialSection } from "./spatialTypes";

type Props = {
  sections: SpatialSection[];
  patientName: string;
};

function SpatialA11yInner({ sections, patientName }: Props) {
  return (
    <div className="spc-sr" aria-label={`Spatial workspace for ${patientName}`}>
      <h2>Patient record sections ({sections.length})</h2>
      <ol>
        {sections.map((s) => (
          <li key={s.id}>
            <h3>{s.title}</h3>
            <ul>
              {s.fields.map((f) => (
                <li key={f.id}>
                  <strong>{f.label}:</strong> {f.primary}
                  {f.secondary ? ` — ${f.secondary}` : ""}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const SpatialA11y = memo(SpatialA11yInner);
