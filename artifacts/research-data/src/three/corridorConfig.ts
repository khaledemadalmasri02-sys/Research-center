export const STOP_WIDTH = 760; // px per stop along the track
export const STAGE_PADDING = 200; // px of empty space on either side

export const CARD_WIDTH = 320;
export const CARD_HEIGHT_ESTIMATE = 220;
export const ROW_HEIGHT = 28;

export type DepthLane = "far" | "mid" | "near";

export type LayoutCard = {
  id: string;
  group: string;
  x: number; // local x relative to stop center
  y: number; // top offset within stop
  width: number;
  depth: DepthLane;
  scale: number; // visual scale based on depth
};

// Default spatial arrangement: a portrait + name on top, then a fan of
// cards layered in depth around the pedestal.
export const CARDS_PER_STOP: Omit<LayoutCard, "id" | "x" | "y" | "width">[] = [
  { group: "identity", depth: "near", scale: 1 },
  { group: "vitals", depth: "mid", scale: 0.92 },
  { group: "diagnosis", depth: "mid", scale: 0.92 },
  { group: "imaging", depth: "far", scale: 0.82 },
  { group: "labs", depth: "far", scale: 0.82 },
  { group: "notes", depth: "far", scale: 0.82 },
];
