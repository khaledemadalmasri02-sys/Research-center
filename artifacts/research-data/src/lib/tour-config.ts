export type TourSource = "animated" | "screen";

export interface TourStepConfig {
  source?: TourSource;
  screenUrl?: string;
}

export interface TourConfig {
  defaultSource: TourSource;
  steps: Record<string, TourStepConfig>;
}

export const DEFAULT_TOUR_CONFIG: TourConfig = { defaultSource: "screen", steps: {} };

export async function fetchTourConfig(signal?: AbortSignal): Promise<TourConfig> {
  const res = await fetch("/api/tour-config", { credentials: "include", signal });
  if (!res.ok) throw new Error("Failed to load tour config");
  return res.json();
}

/**
 * Resolve the video URL to show for a tour step.
 * - "animated" -> the generated explainer at /tour/<key>.mp4
 * - "screen"   -> the admin-uploaded recording (or a <key>-screen.mp4 placeholder)
 */
export function resolveTourVideoSrc(config: TourConfig | undefined, stepKey: string): string {
  const cfg = config ?? DEFAULT_TOUR_CONFIG;
  const step = cfg.steps?.[stepKey];
  const source: TourSource = step?.source ?? cfg.defaultSource ?? "animated";
  if (source === "screen") {
    return step?.screenUrl?.trim() || `/tour/${stepKey}.mp4`;
  }
  return `/tour/${stepKey}.mp4`;
}

/** Whether a step should play a screen recording (video) or show the inline animated SVG scheme. */
export function resolveTourSource(config: TourConfig | undefined, stepKey: string): TourSource {
  const cfg = config ?? DEFAULT_TOUR_CONFIG;
  const step = cfg.steps?.[stepKey];
  return step?.source ?? cfg.defaultSource ?? "animated";
}
