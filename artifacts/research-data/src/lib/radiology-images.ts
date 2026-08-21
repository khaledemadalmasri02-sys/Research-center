export function normalizeRadiologyImages(value: unknown): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v) out.push(v);
  };

  if (Array.isArray(value)) {
    for (const v of value) {
      if (v == null) continue;
      if (typeof v === "string") push(v);
      else if (typeof v === "object") {
        const obj = v as Record<string, unknown>;
        push(obj.objectKey ?? obj.url ?? obj.src ?? obj.path);
      }
    }
    return out;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return out;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeRadiologyImages(parsed);
    } catch {
      // Not JSON — treat the raw string as a single path.
    }
    push(trimmed);
  }

  return out;
}

export function resolveImageSrc(path: string): string {
  if (!path) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/objects/")) return `/api/storage${path}`;
  if (path.startsWith("/")) return path;
  return `/api/storage/objects/${path}`;
}
