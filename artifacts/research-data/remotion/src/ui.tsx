import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const C = {
  bg: "#0b1220",
  bg2: "#0f172a",
  panel: "#16213a",
  panel2: "#1b2a44",
  border: "#2b3a55",
  text: "#e6edf6",
  muted: "#8aa0bd",
  primary: "#0d9488",
  primaryDk: "#0f766e",
  primaryLt: "#2dd4bf",
  purple: "#a855f7",
  purpleDk: "#7c3aed",
  danger: "#ef4444",
  ok: "#22c55e",
  amber: "#f59e0b",
  blue: "#3b82f6",
  white: "#ffffff",
};

const FONT = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export const fill: React.CSSProperties = {
  fontFamily: FONT,
};

/** Fade + slight rise, clamped. Returns a style object. */
export const fade = (
  frame: number,
  at = 0,
  dur = 12,
  y = 10,
): React.CSSProperties => {
  const o = interpolate(frame, [at, at + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ty = interpolate(frame, [at, at + dur], [y, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { opacity: o, transform: `translateY(${ty}px)` };
};

/** Like fade but returns a React node wrapped in a div. */
export const Fade: React.FC<{
  at?: number;
  dur?: number;
  y?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ at = 0, dur = 12, y = 10, style, children }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ ...fade(frame, at, dur, y), ...style }}>{children}</div>
  );
};

export const Card: React.FC<{
  title?: string;
  style?: React.CSSProperties;
  body?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ title, style, body, children }) => (
  <div
    style={{
      background: C.panel,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: 10,
      ...style,
    }}
  >
    {title && (
      <div
        style={{
          fontSize: 11,
          color: C.muted,
          fontWeight: 600,
          marginBottom: 6,
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
    )}
    <div style={body}>{children}</div>
  </div>
);

export const Btn: React.FC<{
  label: string;
  primary?: boolean;
  style?: React.CSSProperties;
}> = ({ label, primary, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 12px",
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 600,
      color: primary ? C.white : C.text,
      background: primary ? C.primary : C.panel2,
      border: `1px solid ${primary ? C.primaryDk : C.border}`,
      ...style,
    }}
  >
    {label}
  </div>
);

export const Chip: React.FC<{
  label: string;
  color?: string;
  style?: React.CSSProperties;
}> = ({ label, color = C.primary, style }) => (
  <span
    style={{
      fontSize: 10,
      fontWeight: 600,
      color,
      background: `${color}22`,
      border: `1px solid ${color}55`,
      borderRadius: 999,
      padding: "2px 8px",
      ...style,
    }}
  >
    {label}
  </span>
);

/** Horizontal bar (value/ max in 0..1). */
export const HBar: React.FC<{
  value: number;
  color?: string;
  height?: number;
  style?: React.CSSProperties;
}> = ({ value, color = C.primary, height = 8, style }) => (
  <div
    style={{
      width: "100%",
      height,
      borderRadius: 999,
      background: C.panel2,
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        width: `${Math.max(0, Math.min(1, value)) * 100}%`,
        height: "100%",
        background: color,
        borderRadius: 999,
      }}
    />
  </div>
);

/** Vertical bar for charts. height in px. */
export const VBar: React.FC<{
  h: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ h, color = C.primary, style }) => (
  <div
    style={{
      width: 22,
      height: h,
      borderRadius: "4px 4px 0 0",
      background: color,
      ...style,
    }}
  />
);

export const Avatar: React.FC<{ label: string; color?: string }> = ({
  label,
  color = C.purple,
}) => (
  <div
    style={{
      width: 26,
      height: 26,
      borderRadius: 999,
      background: `${color}33`,
      border: `1px solid ${color}66`,
      color,
      fontSize: 11,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    {label}
  </div>
);

export const Sidebar: React.FC<{
  items: { key: string; label: string; icon?: string }[];
  active?: string;
  dark?: boolean;
}> = ({ items, active, dark }) => {
  const bg = dark ? C.bg : C.bg2;
  return (
    <div
      style={{
        width: 96,
        flexShrink: 0,
        background: bg,
        borderRight: `1px solid ${C.border}`,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <div
            key={it.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              color: on ? C.white : C.muted,
              background: on ? `${C.primary}26` : "transparent",
              border: `1px solid ${on ? `${C.primary}55` : "transparent"}`,
            }}
          >
            <span style={{ fontSize: 12 }}>{it.icon ?? "•"}</span>
            {it.label}
          </div>
        );
      })}
    </div>
  );
};

export const AppFrame: React.FC<{
  title?: string;
  active?: string;
  sidebar?: { key: string; label: string; icon?: string }[];
  children: React.ReactNode;
}> = ({ title = "MedResearch", active, sidebar, children }) => {
  return (
    <AbsoluteFill style={{ ...fill, background: C.bg, padding: 10 }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 14,
          border: `1px solid ${C.border}`,
          background: C.bg2,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: 30,
            background: `linear-gradient(90deg, ${C.purpleDk}, ${C.purple})`,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 9, background: "#ff5f57" }} />
            <span style={{ width: 9, height: 9, borderRadius: 9, background: "#febc2e" }} />
            <span style={{ width: 9, height: 9, borderRadius: 9, background: "#28c840" }} />
          </div>
          <div style={{ color: "white", fontSize: 12, fontWeight: 700, marginLeft: 4 }}>
            {title}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {sidebar && <Sidebar items={sidebar} active={active} />}
          <div style={{ flex: 1, padding: 12, overflow: "hidden" }}>{children}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SIDEBAR = [
  { key: "dashboard", label: "Home", icon: "▦" },
  { key: "patients", label: "Patients", icon: "☺" },
  { key: "collections", label: "Data", icon: "▤" },
  { key: "dataAnalysis", label: "Analyze", icon: "📈" },
  { key: "feedback", label: "Feedback", icon: "✎" },
  { key: "moreFeatures", label: "More", icon: "✦" },
];
