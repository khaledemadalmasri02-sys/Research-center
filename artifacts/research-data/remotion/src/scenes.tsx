import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  Easing,
  spring,
} from "remotion";
import {
  AppFrame,
  Avatar,
  Btn,
  Card,
  Chip,
  C,
  Fade,
  HBar,
  SIDEBAR,
  VBar,
  fill,
} from "./ui";

const AR = "'Noto Sans Arabic', 'Inter', sans-serif";

/** Staggered row: fades/rises in one after another. */
const Stagger: React.FC<{
  i?: number;
  at?: number;
  step?: number;
  dur?: number;
  y?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ i = 0, at = 0, step = 8, dur = 12, y = 10, style, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at + i * step, at + i * step + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ty = interpolate(f, [at + i * step, at + i * step + dur], [y, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity: o, transform: `translateY(${ty}px)`, ...style }}>
      {children}
    </div>
  );
};

const rowBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.panel,
  fontSize: 11,
  color: C.text,
};

/* 1. WELCOME ---------------------------------------------------------- */
export const WelcomeScene: React.FC = () => {
  const f = useCurrentFrame();
  const pulse = 1 + Math.sin(f / 8) * 0.04;
  return (
    <AppFrame active="dashboard" sidebar={SIDEBAR}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        <Fade at={0}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.white }}>
            Welcome to <span style={{ color: C.primaryLt }}>MedResearch</span>
          </div>
        </Fade>
        <Fade at={14}>
          <div style={{ fontSize: 12, color: C.muted, maxWidth: 360 }}>
            Your research workspace for patients, datasets, and analysis. Take
            the guided tour to learn the essentials.
          </div>
        </Fade>
        <Fade at={28} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label="Patients" color={C.primary} />
          <Chip label="Collections" color={C.blue} />
          <Chip label="Analysis" color={C.amber} />
          <Chip label="Feedback" color={C.purple} />
        </Fade>
        <Fade at={44}>
          <div style={{ transform: `scale(${pulse})`, transition: "transform .2s", display: "inline-block" }}>
            <Btn label="▶  Start the tour" primary />
          </div>
        </Fade>
      </div>
    </AppFrame>
  );
};

/* 2. DASHBOARD -------------------------------------------------------- */
export const DashboardScene: React.FC = () => {
  const f = useCurrentFrame();
  const stats = [
    { label: "Patients", value: 1284, color: C.primary, pct: 0.72 },
    { label: "Collections", value: 37, color: C.blue, pct: 0.41 },
    { label: "Analyses", value: 96, color: C.amber, pct: 0.58 },
  ];
  const bars = [0.4, 0.7, 0.55, 0.9, 0.65, 0.8, 1.0];
  return (
    <AppFrame active="dashboard" sidebar={SIDEBAR}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {stats.map((s, i) => {
          const v = Math.round(
            interpolate(f, [10 + i * 6, 40 + i * 6], [0, s.value], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          );
          return (
            <Stagger key={s.label} i={i} at={4}>
              <Card>
                <div style={{ fontSize: 10, color: C.muted }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{v.toLocaleString()}</div>
                <div style={{ marginTop: 6 }}>
                  <HBar value={s.pct} color={s.color} />
                </div>
              </Card>
            </Stagger>
          );
        })}
      </div>
      <Stagger i={3} at={4} style={{ marginTop: 10 }}>
        <Card title="Enrollments (last 7 days)">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90 }}>
            {bars.map((b, i) => {
              const h = interpolate(f, [30 + i * 5, 55 + i * 5], [4, b * 84], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return <VBar key={i} h={h} color={i === bars.length - 1 ? C.primaryLt : C.primary} />;
            })}
          </div>
        </Card>
      </Stagger>
    </AppFrame>
  );
};

/* 3. PATIENTS --------------------------------------------------------- */
export const PatientsScene: React.FC = () => {
  const f = useCurrentFrame();
  const patients = [
    { n: "Jane Doe", m: "JD", sub: " Hypertension" },
    { n: "John Smith", m: "JS", sub: " Diabetes T2" },
    { n: "Aisha K.", m: "AK", sub: " Asthma" },
    { n: "Mohamed R.", m: "MR", sub: " CKD" },
  ];
  const detailAt = 70;
  const slide = interpolate(f, [detailAt, detailAt + 18], [110, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const detailO = interpolate(f, [detailAt, detailAt + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AppFrame active="patients" sidebar={SIDEBAR}>
      <div style={{ display: "flex", gap: 10, height: "100%" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <Stagger at={2}><div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>Patients</div></Stagger>
          {patients.map((p, i) => (
            <Stagger key={p.n} i={i} at={6}>
              <div style={{ ...rowBase, borderColor: i === 0 ? C.primary : C.border, background: i === 0 ? `${C.primary}1a` : C.panel }}>
                <Avatar label={p.m} />
                <div>
                  <div style={{ fontWeight: 600, color: C.white }}>{p.n}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{p.sub}</div>
                </div>
              </div>
            </Stagger>
          ))}
        </div>
        <div
          style={{
            width: 200,
            transform: `translateX(${slide}%)`,
            opacity: detailO,
          }}
        >
          <Card title="Patient record" style={{ background: C.panel2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Avatar label="JD" color={C.primary} />
              <div style={{ fontWeight: 700, color: C.white }}>Jane Doe</div>
            </div>
            <Line k="Age" v="54" />
            <Line k="Sex" v="F" />
            <Line k="Dx" v="Hypertension" />
            <Line k="Vitals" v="Stable" />
            <div style={{ marginTop: 8 }}>
              <Btn label="Open chart" primary />
            </div>
          </Card>
        </div>
      </div>
    </AppFrame>
  );
};

const Line: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
    <span style={{ color: C.muted }}>{k}</span>
    <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
  </div>
);

/* 4. COLLECTIONS ------------------------------------------------------ */
export const CollectionsScene: React.FC = () => {
  const f = useCurrentFrame();
  const fields = [
    { n: "name", t: "text", icon: C.primary },
    { n: "age", t: "number", icon: C.blue },
    { n: "diagnosis", t: "text", icon: C.amber },
    { n: "vitals", t: "json", icon: C.purple },
  ];
  const newAt = 80;
  const newO = interpolate(f, [newAt, newAt + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const newH = interpolate(f, [newAt, newAt + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AppFrame active="collections" sidebar={SIDEBAR}>
      <Stagger at={2}><div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 6 }}>Collection · health_records</div></Stagger>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {fields.map((fl, i) => (
          <Stagger key={fl.n} i={i} at={6}>
            <div style={{ ...rowBase }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: fl.icon }} />
              <span style={{ fontWeight: 600, color: C.white, width: 110 }}>{fl.n}</span>
              <Chip label={fl.t} color={fl.icon} />
            </div>
          </Stagger>
        ))}
        <div style={{ ...rowBase, opacity: newO, transform: `scaleY(${newH})`, transformOrigin: "top", borderColor: C.primary, background: `${C.primary}14` }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: C.ok }} />
          <span style={{ fontWeight: 600, color: C.white, width: 110 }}>notes</span>
          <Chip label="text" color={C.ok} />
        </div>
      </div>
      <Stagger i={fields.length + 1} at={6} style={{ marginTop: 10 }}>
        <Btn label="＋ Add field" primary />
      </Stagger>
    </AppFrame>
  );
};

/* 5. DATA ANALYSIS ---------------------------------------------------- */
export const DataAnalysisScene: React.FC = () => {
  const f = useCurrentFrame();
  const analyzeAt = 60;
  const resultAt = 120;
  const growth = interpolate(f, [analyzeAt, analyzeAt + 50], [4, 84], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bars = [0.5, 0.8, 0.6, 1.0, 0.7];
  const resultO = interpolate(f, [resultAt, resultAt + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const btnLabel = f < analyzeAt ? "Analyze dataset" : f < resultAt ? "Analyzing…" : "Re-run";
  return (
    <AppFrame active="dataAnalysis" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 6 }}>Data analysis</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Card title="Dataset preview">
            {[0, 1, 2, 3].map((r) => (
              <div key={r} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                {[0, 1, 2, 3, 4].map((c) => (
                  <div key={c} style={{ flex: 1, height: 10, borderRadius: 3, background: C.panel2 }} />
                ))}
              </div>
            ))}
          </Card>
        </div>
        <div style={{ width: 200 }}>
          <Card title="Result">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 84 }}>
              {bars.map((b, i) => (
                <VBar key={i} h={i === 3 ? growth : b * 70} color={i === 3 ? C.amber : C.primary} />
              ))}
            </div>
            <div style={{ opacity: resultO, marginTop: 8, fontSize: 11, color: C.muted }}>
              <div>p = 0.02</div>
              <Chip label="Significant" color={C.ok} style={{ marginTop: 4 }} />
            </div>
          </Card>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Btn label={btnLabel} primary={f < analyzeAt || f >= resultAt} />
      </div>
    </AppFrame>
  );
};

/* 6. FEEDBACK --------------------------------------------------------- */
export const FeedbackScene: React.FC = () => {
  const f = useCurrentFrame();
  const text = "The new analysis view is fantastic — saved me hours!";
  const shown = Math.round(
    interpolate(f, [20, 60], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
  const sentAt = 90;
  const toastO = interpolate(f, [sentAt, sentAt + 12, sentAt + 60, sentAt + 80], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AppFrame active="feedback" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 6 }}>Send feedback</div>
      <Card>
        <div
          style={{
            minHeight: 70,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.bg2,
            padding: 8,
            fontSize: 12,
            color: C.text,
          }}
        >
          {text.slice(0, shown)}
          {shown < text.length && <span style={{ color: C.primaryLt }}>▋</span>}
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <Btn label={f < sentAt ? "Send" : "Sent ✓"} primary={f >= sentAt} />
        </div>
      </Card>
      <div style={{ opacity: toastO, position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)" }}>
        <div style={{ background: C.ok, color: C.white, padding: "8px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, boxShadow: "0 8px 20px rgba(0,0,0,.4)" }}>
          Thanks! Feedback submitted
        </div>
      </div>
    </AppFrame>
  );
};

/* 7. MORE FEATURES ---------------------------------------------------- */
export const MoreFeaturesScene: React.FC = () => {
  const tiles = [
    { t: "API", icon: "⚡", c: C.primary },
    { t: "Sessions", icon: "🖥", c: C.blue },
    { t: "Activity", icon: "⏱", c: C.amber },
    { t: "Invite", icon: "✉", c: C.purple },
    { t: "Exports", icon: "⤓", c: C.ok },
    { t: "Settings", icon: "⚙", c: C.muted },
    { t: "Billing", icon: "$", c: C.danger },
    { t: "Help", icon: "?", c: C.primaryLt },
    { t: "Lab", icon: "✦", c: C.purple },
  ];
  return (
    <AppFrame active="moreFeatures" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 8 }}>More features</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {tiles.map((t, i) => (
          <Stagger key={t.t} i={i} at={4} step={5}>
            <div
              style={{
                ...rowBase,
                position: "relative",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                height: 56,
                borderColor: i === 8 ? C.purple : C.border,
                background: i === 8 ? `${C.purple}1a` : C.panel,
              }}
            >
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <span style={{ fontWeight: 600, color: C.white }}>{t.t}</span>
              {i === 8 && <Chip label="New" color={C.purple} style={{ position: "absolute", top: 6, right: 6 }} />}
            </div>
          </Stagger>
        ))}
      </div>
    </AppFrame>
  );
};

/* 8. MY ACTIVITY ------------------------------------------------------ */
export const MyActivityScene: React.FC = () => {
  const f = useCurrentFrame();
  const events = [
    { t: "Signed in", s: "just now", c: C.primary },
    { t: "Edited patient Jane Doe", s: "2m ago", c: C.blue },
    { t: "Ran analysis #96", s: "15m ago", c: C.amber },
    { t: "Exported collection", s: "1h ago", c: C.ok },
    { t: "Updated API token", s: "3h ago", c: C.purple },
  ];
  return (
    <AppFrame active="myActivity" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 8 }}>My activity</div>
      <div style={{ position: "relative", paddingLeft: 14 }}>
        <div style={{ position: "absolute", left: 4, top: 4, bottom: 4, width: 2, background: C.border }} />
        {events.map((e, i) => (
          <Stagger key={e.t} i={i} at={4} step={10}>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: e.c, position: "absolute", left: 0, border: `2px solid ${C.bg2}` }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.white }}>{e.t}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{e.s}</div>
              </div>
            </div>
          </Stagger>
        ))}
      </div>
    </AppFrame>
  );
};

/* 9. API TOKENS ------------------------------------------------------- */
export const ApiTokensScene: React.FC = () => {
  const f = useCurrentFrame();
  const createAt = 40;
  const copyAt = 95;
  const tokenO = interpolate(f, [createAt, createAt + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const copied = f >= copyAt;
  const token = "mr_live_8f2c4a9e7b1d6c03a5f24e90";
  return (
    <AppFrame active="apiTokens" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 8 }}>API tokens</div>
      <Card title="Personal access tokens">
        <div style={{ opacity: tokenO }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>New token (copy now)</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ flex: 1, fontFamily: "monospace", fontSize: 11, color: C.primaryLt, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", overflow: "hidden", whiteSpace: "nowrap" }}>
              {token}
            </div>
            <Btn label={copied ? "Copied ✓" : "Copy"} primary={copied} />
          </div>
        </div>
        {!tokenO && <Btn label="＋ Create token" primary />}
      </Card>
    </AppFrame>
  );
};

/* 10. SESSIONS -------------------------------------------------------- */
export const SessionsScene: React.FC = () => {
  const f = useCurrentFrame();
  const revokeAt = 70;
  const dim = interpolate(f, [revokeAt, revokeAt + 16], [1, 0.35], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sessions = [
    { d: "MacBook Pro", loc: "Cairo · now", me: true },
    { d: "iPhone 15", loc: "Alexandria", me: false },
    { d: "Chrome · Windows", loc: "Giza", me: false },
  ];
  return (
    <AppFrame active="sessions" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 8 }}>Active sessions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sessions.map((s, i) => {
          const revoked = i === 2 && f >= revokeAt;
          return (
            <Stagger key={s.d} i={i} at={4}>
              <div style={{ ...rowBase, opacity: revoked ? dim : 1, borderColor: revoked ? C.danger : C.border }}>
                <span style={{ fontSize: 16 }}>🖥</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: C.white }}>{s.d}{s.me && " (this device)"}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{s.loc}</div>
                </div>
                {revoked ? (
                  <Chip label="Revoked" color={C.danger} />
                ) : (
                  <span style={{ fontSize: 10, color: C.primaryLt }}>active</span>
                )}
              </div>
            </Stagger>
          );
        })}
      </div>
      <Stagger i={3} at={4} style={{ marginTop: 10 }}>
        <Btn label="Revoke Chrome · Windows" />
      </Stagger>
    </AppFrame>
  );
};

/* 11. NOTIFICATIONS --------------------------------------------------- */
export const NotificationsScene: React.FC = () => {
  const f = useCurrentFrame();
  const openAt = 50;
  const dropO = interpolate(f, [openAt, openAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dropY = interpolate(f, [openAt, openAt + 14], [-10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const items = [
    { t: "New comment on analysis #96", c: C.primary },
    { t: "Jane Doe updated a record", c: C.blue },
    { t: "Weekly report ready", c: C.ok },
  ];
  return (
    <AppFrame active="notifications" sidebar={SIDEBAR}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 40, filter: f < openAt ? "none" : "drop-shadow(0 0 6px rgba(168,85,247,.7))" }}>
            🔔
            <span style={{ position: "absolute", top: -4, right: -6, background: C.danger, color: "white", fontSize: 9, fontWeight: 700, borderRadius: 99, padding: "1px 4px" }}>3</span>
          </div>
          <div style={{ opacity: dropO, transform: `translateY(${dropY}px)`, position: "absolute", top: 52, right: -10, width: 220 }}>
            <Card title="Notifications">
              {items.map((n, i) => (
                <Stagger key={i} i={i} at={openAt} step={4}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.text }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: n.c }} />
                    {n.t}
                  </div>
                </Stagger>
              ))}
            </Card>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>Click the bell to see updates</div>
      </div>
    </AppFrame>
  );
};

/* 12. THEME ----------------------------------------------------------- */
export const ThemeScene: React.FC = () => {
  const f = useCurrentFrame();
  const toggleAt = 60;
  const dark = f < toggleAt;
  const bg = dark ? "#0b1220" : "#eef2f7";
  const panel = dark ? C.panel : "#ffffff";
  const text = dark ? C.white : "#0f172a";
  const muted = dark ? C.muted : "#64748b";
  const knob = interpolate(f, [toggleAt - 1, toggleAt + 1], [4, 26], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AppFrame active="theme" sidebar={SIDEBAR}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, transition: "background .3s" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: text }}>Appearance</div>
        <div style={{ background: panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: text, fontWeight: 600 }}>Card title</div>
          <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>Theme follows your system or toggles here.</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: muted }}>{dark ? "Dark" : "Light"}</span>
            <div style={{ width: 46, height: 24, borderRadius: 99, background: C.primary, position: "relative" }}>
              <div style={{ position: "absolute", top: 3, left: knob, width: 18, height: 18, borderRadius: 99, background: "white" }} />
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
};

/* 13. LANGUAGE -------------------------------------------------------- */
export const LanguageScene: React.FC = () => {
  const f = useCurrentFrame();
  const switchAt = 70;
  const ar = f >= switchAt;
  return (
    <AppFrame active="language" sidebar={SIDEBAR}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>Language</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ ...rowBase, flex: 1, borderColor: !ar ? C.primary : C.border, background: !ar ? `${C.primary}1a` : C.panel, justifyContent: "center" }}>
            <span style={{ fontWeight: 700, color: C.white }}>English</span>
          </div>
          <div style={{ ...rowBase, flex: 1, borderColor: ar ? C.primary : C.border, background: ar ? `${C.primary}1a` : C.panel, justifyContent: "center", fontFamily: AR }}>
            <span style={{ fontWeight: 700, color: C.white }}>العربية</span>
          </div>
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.white, fontFamily: ar ? AR : "inherit" }}>
            {ar ? "لوحة التحكم" : "Dashboard"}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontFamily: ar ? AR : "inherit" }}>
            {ar ? "مرحباً بك في مساحة البحث" : "Welcome to your research workspace"}
          </div>
        </div>
      </div>
    </AppFrame>
  );
};

/* 14. ADMIN ----------------------------------------------------------- */
export const AdminScene: React.FC = () => {
  const f = useCurrentFrame();
  const approveAt = 80;
  const users = [
    { n: "admin@lab.org", r: "Admin", pending: false },
    { n: "sara@lab.org", r: "Editor", pending: false },
    { n: "new.user@lab.org", r: "Viewer", pending: true },
  ];
  return (
    <AppFrame active="admin" sidebar={SIDEBAR}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.white, marginBottom: 8 }}>User management</div>
      <Card title="Members">
        {users.map((u, i) => {
          const approved = u.pending && f >= approveAt;
          return (
            <Stagger key={u.n} i={i} at={4}>
              <div style={{ ...rowBase, marginBottom: 6, borderColor: approved ? C.ok : C.border }}>
                <Avatar label={u.n[0].toUpperCase()} color={C.purple} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: C.white, fontSize: 11 }}>{u.n}</div>
                </div>
                <Chip label={u.r} color={C.blue} />
                {u.pending ? (
                  approved ? <Chip label="Active" color={C.ok} /> : <Chip label="Pending" color={C.amber} />
                ) : (
                  <Chip label="Active" color={C.ok} />
                )}
              </div>
            </Stagger>
          );
        })}
        <div style={{ marginTop: 4 }}>
          <Btn label={f >= approveAt ? "Approve new.user@lab.org ✓" : "Approve new.user@lab.org"} primary={f >= approveAt} />
        </div>
      </Card>
    </AppFrame>
  );
};

/* 15. FINISH ---------------------------------------------------------- */
export const FinishScene: React.FC = () => {
  const f = useCurrentFrame();
  const draw = interpolate(f, [20, 55], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pop = spring({ frame: f - 30, fps: 30, config: { damping: 12 } });
  const confetti = Array.from({ length: 14 });
  return (
    <AbsoluteFill style={{ ...fill, background: C.bg, alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: 120, height: 120, transform: `scale(${pop})` }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke={C.primary} strokeWidth="6" opacity="0.25" />
          <circle cx="60" cy="60" r="52" fill="none" stroke={C.primaryLt} strokeWidth="6" strokeDasharray="1" strokeDashoffset={draw} pathLength={1} transform="rotate(-90 60 60)" />
          <path d="M40 62 L54 76 L82 46" fill="none" stroke={C.white} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={draw} pathLength={1} />
        </svg>
      </div>
      <Fade at={40}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.white, marginTop: 16 }}>You're all set!</div>
      </Fade>
      <Fade at={54}>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>You can replay this tour anytime from the Tutor button.</div>
      </Fade>
      {confetti.map((_, i) => {
        const a = (i / confetti.length) * Math.PI * 2;
        const dist = interpolate(f, [40, 90], [0, 70 + (i % 4) * 14], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const ox = Math.cos(a) * dist;
        const oy = Math.sin(a) * dist;
        const o = interpolate(f, [40, 55, 95], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const colors = [C.primary, C.purple, C.amber, C.ok, C.blue];
        return (
          <div key={i} style={{ position: "absolute", left: "50%", top: "42%", width: 6, height: 6, borderRadius: 2, background: colors[i % colors.length], transform: `translate(${ox}px, ${oy}px)`, opacity: o }} />
        );
      })}
    </AbsoluteFill>
  );
};
