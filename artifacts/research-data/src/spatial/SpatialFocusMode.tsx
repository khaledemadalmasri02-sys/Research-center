import type { SpatialField, SpatialSection } from "./spatialTypes";

type Props = {
  open: boolean;
  section: SpatialSection | null;
  field: SpatialField | null;
  patientName: string;
  onClose: () => void;
  onOpen2D: () => void;
};

export function SpatialFocusMode({ open, section, field, patientName, onClose, onOpen2D }: Props) {
  if (!open || !section || !field) return null;
  return (
    <div
      className="spc-focus-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${field.label} focus mode`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="spc-focus-card">
        <button
          type="button"
          className="spc-focus-close spc-focusable"
          onClick={onClose}
          aria-label="Close focus mode"
        >
          ×
        </button>
        <div className="spc-focus-sub">{section.title} · {patientName}</div>
        <h2 className="spc-focus-title">{field.label}</h2>
        <div className="spc-focus-primary">{field.primary}</div>
        {field.secondary && <div className="spc-focus-secondary">{field.secondary}</div>}
        {field.meta && <div className="spc-focus-meta">{field.meta}</div>}
        <div className="spc-focus-actions">
          <button type="button" className="spc-focus-btn" onClick={onOpen2D}>
            Open full record
          </button>
          <button
            type="button"
            className="spc-focus-btn"
            data-variant="ghost"
            onClick={onClose}
          >
            Back to spatial view (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
