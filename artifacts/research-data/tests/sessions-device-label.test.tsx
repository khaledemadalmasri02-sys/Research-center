/**
 * Device labelling and recency grouping on the sessions page.
 *
 * `describeDevice` is the piece that decides whether a user can recognise their
 * own session, and the piece that must NOT leak a raw `userAgent` string. Both
 * are asserted directly, plus the grouping order and the `ref`-only invariant.
 */
import { describe, expect, it } from "vitest";

import {
  describeDevice,
  formatTimestamp,
  groupSessionsByRecency,
  isBotUserAgent,
  sessionActivityTime,
  type SessionRow,
} from "@/pages/sessions";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
/* iPadOS in desktop mode: byte-for-byte a Mac UA except for `Mobile/`. */
const SAFARI_IPAD_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 Mobile/15E148";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CHROME_OS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CURL = "curl/8.5.0";

describe("describeDevice", () => {
  it("produces a coarse, human label — never the raw UA string", () => {
    expect(describeDevice(CHROME_WINDOWS).label).toBe("Chrome on Windows");
    expect(describeDevice(SAFARI_MAC).label).toBe("Safari on macOS");
    expect(describeDevice(FIREFOX_LINUX).label).toBe("Firefox on Linux");
    expect(describeDevice(EDGE_WINDOWS).label).toBe("Edge on Windows");
    expect(describeDevice(CHROME_OS).label).toBe("Chrome on ChromeOS");
  });

  it("does not mistake Chromium-family browsers for Safari or Chrome", () => {
    // Every Chromium UA contains both "Chrome/" and "Safari/", so a naive
    // ordered test gets this wrong for every Windows user on the planet.
    expect(describeDevice(EDGE_WINDOWS).label).not.toContain("Safari");
    expect(describeDevice(SAFARI_MAC).label).not.toContain("Chrome");
    expect(describeDevice(SAFARI_IPHONE).label).toBe("Safari on iPhone");
  });

  it("recognises a tablet that reports a desktop macOS user agent", () => {
    const device = describeDevice(SAFARI_IPAD_DESKTOP);
    expect(device.label).toBe("Safari on iPad");
    expect(device.kind).toBe("tablet");
    expect(describeDevice(ANDROID_TABLET).kind).toBe("tablet");
  });

  it("separates phones from tablets", () => {
    expect(describeDevice(SAFARI_IPHONE).kind).toBe("mobile");
    expect(describeDevice(ANDROID_TABLET).kind).toBe("tablet");
  });

  it("flags non-browser clients instead of mislabelling them", () => {
    expect(isBotUserAgent(CURL)).toBe(true);
    expect(describeDevice(CURL).kind).toBe("bot");
    expect(isBotUserAgent(CHROME_WINDOWS)).toBe(false);
  });

  it("returns a blank label for missing or unusable input, so the caller can localise it", () => {
    for (const input of [null, undefined, "", "   ", "x"]) {
      const device = describeDevice(input);
      expect(device.label).toBe("");
      expect(device.kind).toBe("unknown");
    }
  });

  it("never echoes UA substrings into the label", () => {
    const uas = [CHROME_WINDOWS, SAFARI_MAC, SAFARI_IPHONE, FIREFOX_LINUX, EDGE_WINDOWS, CURL];
    for (const ua of uas) {
      const { label } = describeDevice(ua);
      // No path, no version string, no vendor build token.
      expect(label).not.toMatch(/Mozilla|Gecko|KHTML|AppleWebKit|\d+\.\d+/);
      // A blank label is the caller's cue to use localised "Unrecognised device",
      // so it must not be a substring of anything.
      if (label) expect(ua).not.toContain(label);
    }
  });
});

/* -------------------------------------------------------------------------- */

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function row(patch: Partial<SessionRow> & { ref: string }): SessionRow {
  return {
    lastActivityAt: hoursAgo(1),
    createdAt: hoursAgo(48),
    expiresAt: hoursAgo(-72),
    ip: "203.0.113.7",
    userAgent: CHROME_WINDOWS,
    ...patch,
  };
}

describe("groupSessionsByRecency", () => {
  it("puts the current session first, in its own group", () => {
    const groups = groupSessionsByRecency(
      [row({ ref: "a", lastActivityAt: hoursAgo(0) }), row({ ref: "b", current: true })],
      NOW,
    );
    expect(groups[0].id).toBe("current");
    expect(groups[0].sessions.map((s) => s.ref)).toEqual(["b"]);
  });

  it("buckets by last activity, not by creation", () => {
    // Created last month, used an hour ago: an ACTIVE session.
    const groups = groupSessionsByRecency(
      [
        row({ ref: "fresh" }),
        row({ ref: "old-created", createdAt: hoursAgo(24 * 40), lastActivityAt: hoursAgo(1) }),
        row({ ref: "idle-week", lastActivityAt: hoursAgo(24 * 3) }),
        row({ ref: "ancient", lastActivityAt: hoursAgo(24 * 30) }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.id)).toEqual(["today", "week", "older"]);
    expect(groups[0].sessions.map((s) => s.ref)).toEqual(["fresh", "old-created"]);
  });

  it("omits empty groups entirely", () => {
    const groups = groupSessionsByRecency([row({ ref: "a", current: true })], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("current");
  });

  it("orders within a group newest first and breaks ties stably", () => {
    const groups = groupSessionsByRecency(
      [
        row({ ref: "b", lastActivityAt: hoursAgo(2) }),
        row({ ref: "a", lastActivityAt: hoursAgo(2) }),
        row({ ref: "newest", lastActivityAt: hoursAgo(0.1) }),
      ],
      NOW,
    );
    // Ties break on `ref`, so a refetch cannot reshuffle the list under the user.
    expect(groups[0].sessions.map((s) => s.ref)).toEqual(["newest", "a", "b"]);
  });

  it("survives rows with no usable timestamps", () => {
    const groups = groupSessionsByRecency([row({ ref: "bare", lastActivityAt: null, createdAt: null, expiresAt: null })], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("older");
  });
});

describe("sessionActivityTime / formatTimestamp", () => {
  it("prefers lastActivityAt, then createdAt, then expiresAt", () => {
    expect(sessionActivityTime(row({ ref: "x", lastActivityAt: hoursAgo(1), createdAt: hoursAgo(9) }))).toBe(
      NOW - 3_600_000,
    );
    expect(sessionActivityTime(row({ ref: "x", lastActivityAt: null, createdAt: hoursAgo(9) }))).toBe(
      NOW - 9 * 3_600_000,
    );
    expect(sessionActivityTime(row({ ref: "x", lastActivityAt: null, createdAt: null }))).toBe(
      NOW + 72 * 3_600_000,
    );
  });

  it("returns an empty string for an unparseable date instead of 'Invalid Date'", () => {
    expect(formatTimestamp("not-a-date")).toBe("");
    expect(formatTimestamp(null)).toBe("");
    expect(formatTimestamp("2026-10-03T12:00:00.000Z")).not.toBe("");
  });
});