#!/usr/bin/env python3
"""Generate feature-reflective animated "scheme" MP4s for the product tour.

Each clip draws a small animated mockup of the actual feature UI so the tutor
video demonstrates what the feature does, not just a title card.
"""
import subprocess
import os

ROOT = "/home/khaled/Desktop/data research/artifacts/research-data"
OUT = os.path.join(ROOT, "public", "tour")
FONT = "/usr/share/fonts/truetype/lato/Lato-Medium.ttf"
ARFONT = "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"

ACCENT = {
    "welcome": "0x38bdf8",
    "dashboard": "0x34d399",
    "patients": "0xa78bfa",
    "collections": "0xf472b6",
    "dataAnalysis": "0xfbbf24",
    "feedback": "0xf87171",
    "moreFeatures": "0x22d3ee",
    "myActivity": "0x818cf8",
    "apiTokens": "0x2dd4bf",
    "sessions": "0x60a5fa",
    "notifications": "0xfb923c",
    "theme": "0xc084fc",
    "language": "0x4ade80",
    "admin": "0xf43f5e",
    "finish": "0x10b981",
}

TITLE = {
    "welcome": "Welcome",
    "dashboard": "Dashboard",
    "patients": "Patients",
    "collections": "Collections",
    "dataAnalysis": "Data Analysis",
    "feedback": "Feedback",
    "moreFeatures": "More Features",
    "myActivity": "My Activity",
    "apiTokens": "API Tokens",
    "sessions": "Sessions",
    "notifications": "Notifications",
    "theme": "Theme",
    "language": "Language",
    "admin": "Admin",
    "finish": "You are all set",
}


class FB:
    def __init__(self):
        self.cmds = []
        self.prev = "[0:v]"
        self.n = 0

    def step(self, filt):
        lbl = f"f{self.n}"
        self.cmds.append(f"{self.prev}{filt}[{lbl}]")
        self.prev = f"[{lbl}]"
        self.n += 1
        return lbl

    def build(self):
        return ";".join(self.cmds)


def rect(x, y, w, h, color, start=None, t=-1):
    en = f":enable='gte(t\\,{start})'" if start is not None else ""
    return f"drawbox=x={x}:y={y}:w={w}:h={h}:color={color}:t={t}{en}"


def circ(x, y, d, color, start=None, t=3):
    en = f":enable='gte(t\\,{start})'" if start is not None else ""
    return f"drawbox=x={x}:y={y}:w={d}:h={d}:c=1:color={color}:t={t}{en}"


def text(s, x, y, color, size=14, start=None, fade=0.4, font=FONT):
    s = s.replace("'", "\u2019").replace(":", "\\:")
    if start is None:
        return f"drawtext=fontfile={font}:text='{s}':fontcolor={color}:fontsize={size}:x={x}:y={y}"
    alpha = f":alpha='if(lt(t\\,{start})\\,0\\,if(lt(t\\,{start+fade})\\,(t-{start})/{fade}\\,1))'"
    return f"drawtext=fontfile={font}:text='{s}':fontcolor={color}:fontsize={size}:x={x}:y={y}{alpha}"


def grow_bar(x, baseline, maxh, color, start):
    h = f"min({maxh}\\,(t-{start})*60)"
    y = f"{baseline}-min({maxh}\\,(t-{start})*60)"
    return f"drawbox=x={x}:y='{y}':w=36:h='{h}':color={color}:t=-1:enable='gte(t\\,{start})'"


def prefix(fb, key):
    ac = ACCENT[key]
    fb.step("drawgrid=width=40:height=40:color=0xffffff@0.04:t=1")
    fb.step(rect(110, 64, 420, 244, "0x1e293b"))          # panel fill
    fb.step(rect(110, 64, 420, 244, "0x334155", t=3))     # panel border
    fb.step(text(TITLE[key], 128, 80, "white", 22, start=0, fade=0.5))
    return ac


def scene(key):
    fb = FB()
    ac = prefix(fb, key)

    if key == "welcome":
        # activity pulse glyph + brand + nav chips
        fb.step(rect(150, 188, 44, 4, ac, 0.6))
        fb.step(rect(194, 176, 4, 14, ac, 0.8))
        fb.step(rect(198, 176, 4, 30, ac, 1.0))
        fb.step(rect(202, 202, 4, 14, ac, 1.2))
        fb.step(rect(206, 188, 44, 4, ac, 1.4))
        fb.step(circ(252, 178, 16, ac, 1.6))
        fb.step(text("MedResearch", 280, 184, "white", 20, start=0.6))
        for i, lab in enumerate(["Dash", "Patients", "Data", "Feedback"]):
            fb.step(rect(128 + i * 92, 240, 84, 30, "0x334155", 1.0 + i * 0.2))
            fb.step(text(lab, 140 + i * 92, 250, "0x94a3b8", 13, start=1.0 + i * 0.2))

    elif key == "dashboard":
        cards = [("Records", "1,284"), ("Growth", "+12%"), ("Active", "98%")]
        for i, (lab, num) in enumerate(cards):
            fb.step(rect(128 + i * 128, 104, 116, 52, "0x334155", 0.4 + i * 0.4))
            fb.step(text(lab, 140 + i * 128, 120, "0x94a3b8", 13, start=0.5 + i * 0.4))
            fb.step(text(num, 140 + i * 128, 144, "white", 16, start=1.0 + i * 0.4))
        for i, mh in enumerate([80, 50, 70, 42, 62, 78]):
            fb.step(grow_bar(150 + i * 54, 292, mh, ac, 1.6))

    elif key == "patients":
        names = ["Jane Doe", "John Smith", "Aisha K."]
        for i, nm in enumerate(names):
            fb.step(rect(128, 108 + i * 48, 184, 40, "0x334155", 0.4 + i * 0.4))
            fb.step(text(nm, 140, 122 + i * 48, "white", 13, start=0.5 + i * 0.4))
        fb.step(rect(324, 108, 200, 152, "0x1e293b", 1.4))
        fb.step(text("Record", 336, 120, ac, 14, start=1.5))
        detail = [("Name: Jane Doe", 1.7), ("Age: 54", 1.9), ("Dx: Hypertension", 2.1), ("Vitals OK", 2.3)]
        for s, st in detail:
            fb.step(text(s, 336, 140 + (st - 1.7) * 36, "white", 13, start=st))

    elif key == "collections":
        fb.step(text("Patients schema", 128, 104, "white", 15, start=0.4))
        fields = [("name", "text"), ("age", "number"), ("sex", "select"), ("vitals", "json")]
        for i, (f, ty) in enumerate(fields):
            fb.step(rect(128, 124 + i * 30, 384, 26, "0x334155", 0.7 + i * 0.35))
            fb.step(text(f, 140, 132 + i * 30, "white", 13, start=0.8 + i * 0.35))
            fb.step(rect(450, 127 + i * 30, 52, 20, ac, 0.9 + i * 0.35))
            fb.step(text(ty, 458, 134 + i * 30, "white", 11, start=0.9 + i * 0.35))
        fb.step(rect(128, 250, 384, 30, ac, 2.6))
        fb.step(text("+ Add field", 220, 258, "white", 14, start=2.7))

    elif key == "dataAnalysis":
        for r in range(4):
            for c in range(4):
                fb.step(rect(132 + c * 42, 112 + r * 34, 38, 30, "0x334155", 0.6))
        for i, mh in enumerate([70, 45, 60, 80]):
            fb.step(grow_bar(330 + i * 46, 262, mh, ac, 1.6))
        fb.step(text("Dataset", 132, 104, "white", 14, start=0.4))
        fb.step(text("p = 0.02", 330, 278, ac, 16, start=3.0))
        fb.step(text("significant", 330, 296, "0x94a3b8", 12, start=3.1))

    elif key == "feedback":
        fb.step(rect(128, 108, 384, 120, "0x1e293b", 0.4))
        fb.step(text("Found a bug in the export flow", 140, 132, "white", 14, start=0.7))
        fb.step(rect(420, 232, 84, 28, ac, 1.2))
        fb.step(text("Send", 444, 240, "white", 13, start=1.3))
        fb.step(text("Thanks! Submitted", 140, 250, ac, 14, start=3.0))

    elif key == "moreFeatures":
        for r in range(3):
            for c in range(3):
                i = r * 3 + c
                fb.step(rect(150 + c * 70, 120 + r * 50, 58, 40, "0x334155"))
                fb.step(rect(150 + c * 70, 120 + r * 50, 58, 40, ac, 0.3 + i * 0.12))

    elif key == "myActivity":
        fb.step(rect(150, 110, 3, 170, "0x334155"))
        events = ["Signed in", "Viewed record #12", "Exported dataset", "Updated schema"]
        for i, ev in enumerate(events):
            fb.step(circ(144, 126 + i * 44, 12, ac, 0.5 + i * 0.4))
            fb.step(text(ev, 170, 130 + i * 44, "white", 13, start=0.6 + i * 0.4))

    elif key == "apiTokens":
        fb.step(text("API Token", 128, 104, "white", 15, start=0.4))
        fb.step(circ(146, 150, 26, ac, 0.6))
        fb.step(rect(172, 160, 44, 8, ac, 0.6))
        fb.step(rect(220, 140, 290, 40, "0x1e293b", 1.2))
        fb.step(text("mr_live_8f2c..4a91", 232, 154, "0x94a3b8", 14, start=1.3))
        fb.step(rect(420, 196, 90, 28, ac, 1.8))
        fb.step(text("Copy", 448, 204, "white", 13, start=1.9))

    elif key == "sessions":
        devs = ["Laptop", "Phone", "Tablet"]
        for i, d in enumerate(devs):
            fb.step(rect(128, 108 + i * 48, 384, 40, "0x334155", 0.4 + i * 0.4))
            fb.step(text(d, 140, 122 + i * 48, "white", 13, start=0.5 + i * 0.4))
            fb.step(text("Active", 470, 122 + i * 48, ac, 12, start=0.5 + i * 0.4))
        fb.step(rect(128, 156, 384, 40, "0x0f172a", 3.0))
        fb.step(text("Revoked", 270, 170, "0xef4444", 14, start=3.1))

    elif key == "notifications":
        fb.step(text("Notifications", 128, 104, "white", 15, start=0.4))
        fb.step(circ(468, 118, 28, ac, 0.5))
        fb.step(circ(486, 108, 18, "0xef4444", 1.0))
        fb.step(text("3", 491, 116, "white", 12, start=1.1))
        fb.step(rect(300, 150, 200, 130, "0x1e293b", 1.3))
        fb.step(text("Sign-up approved", 312, 172, "white", 12, start=1.4))
        fb.step(text("Feedback replied", 312, 202, "white", 12, start=1.6))
        fb.step(text("New comment", 312, 232, "0x94a3b8", 12, start=1.8))

    elif key == "theme":
        fb.step(rect(260, 150, 120, 40, "0x334155", 0.4))
        fb.step(rect(128, 108, 384, 150, "0xf1f5f9", 0.4))  # light (shown < t3)
        fb.step(text("Light", 255, 262, "0x0f172a", 14, start=0.6))
        fb.step(rect(266, 154, 32, 32, ac, 0.5))  # knob left (shown < t3)
        fb.step(rect(128, 108, 384, 150, "0x0f172a", 3.0))  # dark (shown >= t3)
        fb.step(text("Dark", 262, 262, "0x94a3b8", 14, start=3.1))
        fb.step(rect(344, 154, 32, 32, ac, 3.0))  # knob right (shown >= t3)

    elif key == "language":
        fb.step(text("Language", 128, 104, "white", 15, start=0.4))
        fb.step(circ(290, 140, 70, "0x334155", 0.4))
        fb.step(rect(324, 140, 2, 70, "0x334155", 0.5))
        fb.step(rect(290, 173, 70, 2, "0x334155", 0.5))
        fb.step(text("EN", 300, 228, "white", 22, start=0.6))
        fb.step(text("ع", 306, 232, "white", 22, start=3.0, font=ARFONT))

    elif key == "admin":
        fb.step(text("Users", 128, 104, "white", 15, start=0.4))
        rows = [("k.always", "Admin"), ("editor.j", "Editor"), ("viewer.m", "Viewer")]
        for i, (nm, role) in enumerate(rows):
            fb.step(rect(128, 124 + i * 30, 384, 26, "0x334155", 0.7 + i * 0.3))
            fb.step(text(nm, 140, 132 + i * 30, "white", 13, start=0.8 + i * 0.3))
            fb.step(rect(430, 127 + i * 30, 70, 20, ac, 0.9 + i * 0.3))
            fb.step(text(role, 444, 134 + i * 30, "white", 11, start=0.9 + i * 0.3))
        fb.step(text("Pending sign-ups: 2", 128, 246, "white", 13, start=1.8))
        fb.step(rect(380, 240, 120, 28, ac, 2.0))
        fb.step(text("Approve", 406, 248, "white", 13, start=2.1))

    elif key == "finish":
        fb.step(circ(288, 140, 64, ac, 0.4))
        fb.step(rect(302, 174, 18, 6, ac, 1.2))
        fb.step(rect(316, 152, 6, 28, ac, 1.6))
        fb.step(text("You are all set", 196, 240, "white", 18, start=0.6))
        fb.step(text("Happy researching", 206, 266, "0x94a3b8", 13, start=1.0))

    return fb


def main():
    os.makedirs(OUT, exist_ok=True)
    for key in ACCENT:
        fb = scene(key)
        fc = fb.build()
        out = os.path.join(OUT, f"{key}.mp4")
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=0x0f172a:s=640x360:d=6",
            "-filter_complex", fc, "-map", fb.prev,
            "-t", "6", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
        ]
        subprocess.run(cmd, check=True)
        print("generated", key + ".mp4")


if __name__ == "__main__":
    main()
