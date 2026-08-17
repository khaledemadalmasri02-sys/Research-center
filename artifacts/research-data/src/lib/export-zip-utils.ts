import { format } from "date-fns";

export type ZipPatient = {
  patientId: string;
  patientName?: string | null;
  radiologyImageFilePathOrLink?: string | null;
  radiologyImages?: string | null;
};

type ProgressCallback = (done: number, total: number) => void;

function parseImagePaths(p: ZipPatient): string[] {
  if (p.radiologyImages) {
    try {
      const arr = JSON.parse(p.radiologyImages);
      if (Array.isArray(arr) && arr.length > 0) return arr as string[];
    } catch { /* fall through */ }
  }
  if (p.radiologyImageFilePathOrLink) return [p.radiologyImageFilePathOrLink];
  return [];
}

function toFetchUrl(path: string): string {
  if (path.startsWith("/objects/")) return `/api/storage${path}`;
  return path;
}

function guessExtension(url: string, contentType: string | null): string {
  if (contentType) {
    if (contentType.includes("png"))  return "png";
    if (contentType.includes("gif"))  return "gif";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  }
  const m = url.match(/\.(png|jpg|jpeg|gif|webp)(\?|$)/i);
  if (m) return m[1]!.toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

async function fetchImage(
  rawPath: string
): Promise<{ blob: Blob; ext: string } | null> {
  const url = toFetchUrl(rawPath);
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext  = guessExtension(rawPath, res.headers.get("content-type"));
    return { blob, ext };
  } catch {
    return null;
  }
}

let JSZip: any = null;

async function loadJSZip(): Promise<any> {
  if (JSZip) return JSZip;
  const module = await import("jszip");
  JSZip = module.default ?? module;
  return JSZip;
}

export async function exportImagesAsZip(
  patients: ZipPatient[],
  onProgress?: ProgressCallback
): Promise<{ downloaded: number; skipped: number }> {
  const zip = new (await loadJSZip())();

  const allImages: Array<{ patient: ZipPatient; path: string; idx: number }> = [];
  for (const p of patients) {
    const paths = parseImagePaths(p);
    paths.forEach((path: string, idx: number) => allImages.push({ patient: p, path, idx }));
  }

  let downloaded = 0;
  let skipped    = 0;

  onProgress?.(0, allImages.length);

  const patientImageCounts = new Map<string, number>();
  for (const p of patients) {
    const id = (p.patientId ?? "unknown").replace(/[<>:"/\\|?*]/g, "_");
    patientImageCounts.set(id, parseImagePaths(p).length);
  }

  for (const { patient, path, idx } of allImages) {
    const result = await fetchImage(path);
    const id = (patient.patientId ?? "unknown").replace(/[<>:"/\\|?*]/g, "_");
    const total = patientImageCounts.get(id) ?? 1;

    const baseName = total === 1 ? id : `${id}(${idx + 1})`;

    if (result) {
      zip.file(`${baseName}.${result.ext}`, result.blob);
      downloaded++;
    } else {
      zip.file(`${baseName}_unavailable.txt`, `Could not fetch: ${path}`);
      skipped++;
    }

    onProgress?.(downloaded + skipped, allImages.length);
  }

  const manifest = patients
    .map((p) => {
      const paths = parseImagePaths(p);
      return [
        `Patient ID : ${p.patientId ?? "—"}`,
        `Name       : ${p.patientName ?? "—"}`,
        `Images     : ${paths.length}`,
        "",
      ].join("\n");
    })
    .join("\n");

  zip.file("manifest.txt", `Patient Image Export\nGenerated: ${new Date().toISOString()}\n\n${manifest}`);

  const blob = await zip.generateAsync({ type: "blob" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `patient_images_${format(new Date(), "yyyy-MM-dd")}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { downloaded, skipped };
}