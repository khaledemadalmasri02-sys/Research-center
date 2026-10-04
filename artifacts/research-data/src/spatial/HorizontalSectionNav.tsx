import type { SpatialSection } from "./spatialTypes";
import { camera } from "./spatialCamera";

type Props = {
  sections: SpatialSection[];
  activeIndex: number;
  onPick: (index: number) => void;
};

export function HorizontalSectionNav({ sections, activeIndex, onPick }: Props) {
  return (
    <nav className="spc-nav" aria-label="Patient record sections">
      {sections.map((s, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "true" : undefined}
            aria-controls={`spc-section-${i}`}
            className="spc-nav-item spc-focusable"
            data-skip-drag
            onClick={() => {
              onPick(i);
              // Also tell camera directly for instant snap (avoids tick latency)
              camera.setSection(i);
            }}
          >
            <span className="ico" aria-hidden="true">{s.icon}</span>
            <span>{s.shortTitle}</span>
          </button>
        );
      })}
    </nav>
  );
}
