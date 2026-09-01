import type { CSSProperties } from "react";

type Motif = "bars" | "card" | "pulse" | "flow" | "grid";

interface SchemeDef {
  accent: string;
  motif: Motif;
}

const SCHEMES: Record<string, SchemeDef> = {
  welcome: { accent: "#38bdf8", motif: "pulse" },
  dashboard: { accent: "#34d399", motif: "bars" },
  patients: { accent: "#a78bfa", motif: "card" },
  collections: { accent: "#f472b6", motif: "card" },
  dataAnalysis: { accent: "#fbbf24", motif: "bars" },
  feedback: { accent: "#f87171", motif: "flow" },
  moreFeatures: { accent: "#22d3ee", motif: "grid" },
  myActivity: { accent: "#818cf8", motif: "flow" },
  apiTokens: { accent: "#2dd4bf", motif: "card" },
  sessions: { accent: "#60a5fa", motif: "card" },
  notifications: { accent: "#fb923c", motif: "pulse" },
  theme: { accent: "#c084fc", motif: "pulse" },
  language: { accent: "#4ade80", motif: "flow" },
  admin: { accent: "#f43f5e", motif: "pulse" },
  finish: { accent: "#10b981", motif: "pulse" },
};

const KEYFRAMES = `
@keyframes ts-bar { from { transform: scaleY(0.18); } to { transform: scaleY(1); } }
@keyframes ts-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes ts-ring { 0% { transform: scale(0.7); opacity: 0.9; } 70% { transform: scale(1.5); opacity: 0; } 100% { transform: scale(1.5); opacity: 0; } }
@keyframes ts-pulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.25); opacity: 1; } }
@keyframes ts-dash { to { stroke-dashoffset: -32; } }
@keyframes ts-fade { 0%, 100% { opacity: 0.18; } 50% { opacity: 0.6; } }
`;

const center: CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

function Bars({ accent }: { accent: string }) {
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={72 + i * 42}
          y={70}
          width={26}
          height={70}
          rx={5}
          fill={accent}
          style={{
            ...center,
            animation: `ts-bar 1.4s ${i * 0.12}s ease-out infinite alternate`,
          }}
        />
      ))}
    </g>
  );
}

function Card({ accent }: { accent: string }) {
  return (
    <g>
      <g style={{ ...center, animation: "ts-float 3.4s ease-in-out infinite" }}>
        <rect x={108} y={52} width={104} height={74} rx={10} fill={accent} opacity={0.92} />
        <rect x={124} y={70} width={72} height={9} rx={4.5} fill="#ffffff" opacity={0.85} />
        <rect x={124} y={88} width={54} height={9} rx={4.5} fill="#ffffff" opacity={0.5} />
        <rect x={124} y={106} width={64} height={9} rx={4.5} fill="#ffffff" opacity={0.5} />
      </g>
      <circle cx={160} cy={42} r={9} fill={accent} style={{ ...center, animation: "ts-ring 2.6s ease-out infinite" }} />
    </g>
  );
}

function Pulse({ accent }: { accent: string }) {
  return (
    <g>
      <circle
        cx={160}
        cy={92}
        r={28}
        fill="none"
        stroke={accent}
        strokeWidth={3}
        style={{ ...center, animation: "ts-ring 2.4s ease-out infinite" }}
      />
      <circle
        cx={160}
        cy={92}
        r={11}
        fill={accent}
        style={{ ...center, animation: "ts-pulse 2.4s ease-in-out infinite" }}
      />
    </g>
  );
}

function Flow({ accent }: { accent: string }) {
  return (
    <g>
      <path
        d="M44 92 H276"
        stroke={accent}
        strokeWidth={2.5}
        strokeDasharray="7 9"
        style={{ animation: "ts-dash 1.1s linear infinite" }}
      />
      <circle cx={44} cy={92} r={9} fill={accent}>
        <animateTransform
          attributeName="transform"
          type="translate"
          from="0 0"
          to="232 0"
          dur="2.6s"
          repeatCount="indefinite"
          calcMode="linear"
        />
      </circle>
      <circle cx={276} cy={92} r={6} fill={accent} opacity={0.5} />
    </g>
  );
}

function Grid({ accent }: { accent: string }) {
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={84 + c * 42}
          y={58 + r * 34}
          width={30}
          height={24}
          rx={6}
          fill={accent}
          style={{ animation: `ts-fade 2.8s ${(r * 4 + c) * 0.12}s ease-in-out infinite` }}
        />,
      );
    }
  }
  return <g>{cells}</g>;
}

function Motif({ def }: { def: SchemeDef }) {
  switch (def.motif) {
    case "bars":
      return <Bars accent={def.accent} />;
    case "card":
      return <Card accent={def.accent} />;
    case "flow":
      return <Flow accent={def.accent} />;
    case "grid":
      return <Grid accent={def.accent} />;
    case "pulse":
    default:
      return <Pulse accent={def.accent} />;
  }
}

export function TourScheme({ stepKey }: { stepKey: string }) {
  const def = SCHEMES[stepKey] ?? SCHEMES.welcome;
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" role="img" aria-label="tutorial animation">
      <defs>
        <linearGradient id="ts-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <style>{KEYFRAMES}</style>
      <rect width="320" height="180" fill="url(#ts-bg)" />
      <g opacity="0.12" stroke="#64748b" strokeWidth="1">
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={180} />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} />
        ))}
      </g>
      <circle cx={160} cy={92} r={62} fill={def.accent} opacity={0.08} />
      <Motif def={def} />
    </svg>
  );
}
