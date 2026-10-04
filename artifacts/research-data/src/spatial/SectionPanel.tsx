import { memo, useEffect, useRef } from "react";
import { SPATIAL_X_SPACING } from "./spatialCamera";
import type { SpatialSection } from "./spatialTypes";
import { FieldCard } from "./FieldCard";

type Props = {
  section: SpatialSection;
  sectionIndex: number;
  activeSectionIndex: number;
  fieldIndex: number;
  reducedMotion: boolean;
  onFocusField: (fieldIndex: number) => void;
};

function SectionPanelInner({
  section,
  sectionIndex,
  activeSectionIndex,
  fieldIndex,
  reducedMotion,
  onFocusField,
}: Props) {
  // Each section is laid out at its own world X position along the track.
  // The track itself is translated so the active section's center lands on
  // the world center. We center the panel by setting `left = worldX - halfW`.
  const worldX = sectionIndex * SPATIAL_X_SPACING;
  const halfW = 320; // half of .spc-section width (640px)
  const leftPx = worldX - halfW;
  const distance = Math.abs(sectionIndex - activeSectionIndex);

  // Depth layer classification (controls z-index + opacity)
  const depth: "horizon" | "far" | "mid" | "near" =
    distance >= 4 ? "horizon" : distance === 3 ? "far" : distance === 2 ? "far" : distance === 1 ? "mid" : "near";

  // Visual transforms based on distance from active section
  const isActive = distance === 0;
  const scale = isActive ? 1 : distance === 1 ? 0.9 : distance === 2 ? 0.78 : distance === 3 ? 0.66 : 0.54;
  const rotateY = isActive ? 0 : (sectionIndex > activeSectionIndex ? -1 : 1) * Math.min(20, distance * 8);
  const z = isActive ? 0 : -distance * 120;
  const opacity = isActive ? 1 : distance === 1 ? 0.85 : distance === 2 ? 0.55 : distance === 3 ? 0.32 : 0.18;
  const blur = distance > 2 ? Math.min(8, (distance - 2) * 2) : 0;

  const stackRef = useRef<HTMLDivElement | null>(null);

  // When the active field changes, scroll it into view inside the section.
  useEffect(() => {
    if (!isActive) return;
    if (fieldIndex < 0) return;
    const stack = stackRef.current;
    if (!stack) return;
    const card = stack.querySelectorAll<HTMLElement>(".spc-field")[fieldIndex];
    if (!card) return;
    const stackRect = stack.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.top < stackRect.top) {
      stack.scrollTo({ top: card.offsetTop - 16, behavior: reducedMotion ? "auto" : "smooth" });
    } else if (cardRect.bottom > stackRect.bottom) {
      stack.scrollTo({
        top: card.offsetTop - stack.clientHeight + card.clientHeight + 16,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [isActive, fieldIndex, section, reducedMotion]);

  return (
    <div
      className="spc-section"
      data-depth={depth}
      data-active={isActive ? "true" : "false"}
      style={{
        left: `${leftPx}px`,
        // The element's center is at worldX. The 3D transforms are applied
        // around the element's own center (transform-origin: center center).
        // Use explicit 0px for X/Y to avoid browser quirks.
        transform: `translate3d(0px, 0px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
        opacity,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
        // Keep far sections from intercepting events
        pointerEvents: distance > 2 ? "none" : "auto",
      }}
    >
      <div className="spc-panel">
        <header className="spc-panel-header">
          <div className="spc-panel-icon" aria-hidden="true">
            {section.icon}
          </div>
          <div>
            <div className="spc-panel-title">{section.title}</div>
            <div className="spc-panel-sub">Section {sectionIndex + 1} of 15</div>
          </div>
          <div className="spc-panel-count">
            {section.fields.length} field{section.fields.length === 1 ? "" : "s"}
          </div>
        </header>
        <div
          ref={stackRef}
          className="spc-stack"
          data-empty={section.fields.length === 0 ? "true" : "false"}
        >
          {section.fields.length === 0 ? (
            <div className="spc-empty">No data in this section</div>
          ) : (
            section.fields.map((f, i) => (
              <FieldCard
                key={f.id}
                field={f}
                fieldIndex={i}
                isFocused={isActive && i === fieldIndex}
                onFocus={onFocusField}
              />
            ))
          )}
        </div>
        <div className="spc-section-no">{String(sectionIndex + 1).padStart(2, "0")} / 15</div>
      </div>
    </div>
  );
}

export const SectionPanel = memo(SectionPanelInner);
