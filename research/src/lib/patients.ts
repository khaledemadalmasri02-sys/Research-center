// Resolve a patient identifier to the actual stored (id, patient_id).
//
// Stored `patient_id` values are often plain numbers (e.g. "1404343"), not the
// "PAT"-prefixed form that filename detection produces, so we try several
// normalisations before giving up:
//   1. exact patient_id match
//   2. "PAT<digits>" or "<digits>" match
//   3. substring match on the digits
//   4. numeric DB id
// Returns null when nothing matches.

export interface ResolvedPatient {
  id: number;
  patientId: string;
}

export async function resolvePatient(
  db: any,
  hint?: string | number | null
): Promise<ResolvedPatient | null> {
  if (hint === undefined || hint === null || hint === "") return null;
  const h = String(hint).trim();

  let row = (await db
    .prepare("SELECT id, patient_id FROM patients WHERE patient_id = ?")
    .bind(h)
    .first()) as any;
  if (!row) {
    const digits = h.replace(/\D/g, "");
    if (digits.length >= 4) {
      row = (await db
        .prepare("SELECT id, patient_id FROM patients WHERE patient_id = ? OR patient_id = ?")
        .bind(`PAT${digits}`, digits)
        .first()) as any;
    }
  }
  if (!row) {
    const digits = h.replace(/\D/g, "");
    if (digits.length >= 4) {
      row = (await db
        .prepare("SELECT id, patient_id FROM patients WHERE patient_id LIKE ?")
        .bind(`%${digits}%`)
        .first()) as any;
    }
  }
  if (!row) {
    const n = Number(h);
    if (Number.isInteger(n) && n > 0) {
      row = (await db
        .prepare("SELECT id, patient_id FROM patients WHERE id = ?")
        .bind(n)
        .first()) as any;
    }
  }
  return row ? { id: row.id, patientId: row.patient_id } : null;
}

// Parse the stored radiology_images column (JSON array, or legacy "|"-joined
// string) into a string array.
export function parseRadiologyImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* fall through to legacy format */
  }
  return String(raw)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Parse the stored radiology_image_file_path_or_link column, which may be a
// single value, a JSON array, or a legacy "|"-joined string, into a string[].
export function parseRadiologyLinks(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* fall through to legacy format */
  }
  return String(raw)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}
