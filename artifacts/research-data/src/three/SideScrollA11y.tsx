import type { RecordRow } from "@/lib/records";
import { fieldsByRecord, recordName } from "./patientFields";

export function SideScrollA11y({ records }: { records: RecordRow[] }) {
  return (
    <div className="ssc-sr" aria-label="Patient records (accessible list)">
      <h2>Patients ({records.length})</h2>
      <ol>
        {records.map((r) => {
          const grouped = fieldsByRecord(r);
          const name = recordName(r);
          const id = (typeof r.data?.patientId === "string" && r.data.patientId) || String(r.id);
          return (
            <li key={r.id}>
              <h3>
                {name} ({id})
              </h3>
              {grouped.identity.length > 0 && (
                <section>
                  <h4>Identity</h4>
                  <ul>
                    {grouped.identity.map((f, i) => (
                      <li key={i}>
                        {f.label}: {f.value}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {grouped.vitals.length > 0 && (
                <section>
                  <h4>Vitals</h4>
                  <ul>
                    {grouped.vitals.map((f, i) => (
                      <li key={i}>
                        {f.label}: {f.value}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {grouped.diagnosis.length > 0 && (
                <section>
                  <h4>Diagnosis</h4>
                  <ul>
                    {grouped.diagnosis.map((f, i) => (
                      <li key={i}>
                        {f.label}: {f.value}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {grouped.notes.length > 0 && (
                <section>
                  <h4>Notes</h4>
                  <ul>
                    {grouped.notes.map((f, i) => (
                      <li key={i}>
                        {f.label}: {f.value}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {grouped.imaging.length > 0 && (
                <section>
                  <h4>Imaging</h4>
                  <ul>
                    {grouped.imaging.map((f, i) => (
                      <li key={i}>
                        {f.label}: {f.value}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
