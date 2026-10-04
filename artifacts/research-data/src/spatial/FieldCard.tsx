import { memo } from "react";
import type { SpatialField } from "./spatialTypes";
import { resolveImageSrc } from "@/lib/radiology-images";

type Props = {
  field: SpatialField;
  fieldIndex: number;
  isFocused: boolean;
  onFocus: (fieldIndex: number) => void;
};

// Check if a value looks like an HTTP(S) image URL
function isDirectImageUrl(v: string): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

// Check if a value looks like a path to an image (S3 object key with image extension or known image prefix)
function looksLikeImagePath(v: string): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return true;
  // Check for known image extensions
  if (/\.(png|jpe?g|gif|webp|tiff?|dcm|svg)$/i.test(trimmed)) return true;
  // Check for known prefixes that indicate image storage paths
  if (/^radiology\//i.test(trimmed)) return true;
  if (/^objects\//i.test(trimmed)) return true;
  // Image field kind should also trigger proper handling
  return false;
}

// Convert raw field primary to array of image URLs
function extractImageUrls(primary: string): string[] {
  if (!primary) return [];
  const trimmed = primary.trim();

  // Already a direct HTTP(S) URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return [trimmed];
  }

  // Try to parse as JSON array (radiologyImages can be stored as JSON string)
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((p) => String(p || "").trim()).filter(Boolean)
        .map((p) => p.startsWith("http://") || p.startsWith("https://") ? p : resolveImageSrc(p));
    }
  } catch {
    // Not JSON - treat as comma-separated or single path
  }

  // Handle comma-separated list (radiologyImages stored as "path1,path2")
  const paths = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return paths.map((p) => {
    if (p.startsWith("http://") || p.startsWith("https://")) return p;
    return resolveImageSrc(p);
  });
}

function FieldCardInner({ field, fieldIndex, isFocused, onFocus }: Props) {
  // Imaging fields are resolved to proper URLs by FieldCard itself (via
  // extractImageUrls → resolveImageSrc). Use `kind === "imaging"` as the
  // primary signal, with `looksLikeImagePath` as a fallback for definitions
  // that weren't mapped to the imaging kind but whose value is clearly an image.
  const shouldRenderAsImage = field.kind === "imaging" || looksLikeImagePath(field.primary);
  const imageSources = shouldRenderAsImage ? extractImageUrls(field.primary) : [];
  const hasImage = imageSources.length > 0;

  return (
    <button
      type="button"
      className="spc-field spc-focusable"
      data-skip-drag
      data-card
      data-sev={field.severity ?? "muted"}
      data-focus={isFocused ? "true" : "false"}
      onClick={() => onFocus(fieldIndex)}
      tabIndex={0}
      aria-label={`${field.label}: ${field.primary}${field.secondary ? ` — ${field.secondary}` : ""}`}
    >
      <div className="spc-field-label">
        <span>{field.label}</span>
        {field.badge && <span className="spc-field-badge">{field.badge}</span>}
        {imageSources.length > 1 && (
          <span className="spc-field-badge ml-2">{imageSources.length}</span>
        )}
      </div>
      {hasImage ? (
        <div className="spc-field-primary p-0">
          {imageSources.length === 1 ? (
            <img
              src={imageSources[0]}
              alt={field.label}
              className="w-full h-auto max-h-48 object-contain bg-black/30 rounded"
              loading="lazy"
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {imageSources.slice(0, 4).map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`${field.label} ${idx + 1}`}
                  className="w-full h-20 object-cover bg-black/30 rounded"
                  loading="lazy"
                />
              ))}
              {imageSources.length > 4 && (
                <div className="text-xs text-muted-foreground text-center mt-auto">+ {imageSources.length - 4} more</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="spc-field-primary">{field.primary || "Not recorded"}</div>
      )}
      {field.secondary && !hasImage && <div className="spc-field-secondary">{field.secondary}</div>}
      {field.meta && <div className="spc-field-meta">{field.meta}</div>}
    </button>
  );
}

export const FieldCard = memo(FieldCardInner);