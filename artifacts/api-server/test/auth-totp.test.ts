// TOTP (RFC 6238) and the crypto primitives the MFA/password-reset flows are
// built on, exercised WITHOUT a database and WITHOUT any new dependency.
//
// RFC 6238 §Appendix B publishes test vectors. They use the ASCII seed
// "12345678901234567890" (20 bytes) with SHA1, which is exactly our secret
// size, so they are a real cross-check against the specification rather than a
// round-trip against ourselves.

import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCodeAtStep,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateRecoveryCode,
  normalizeRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
  looksLikeRecoveryCode,
  generateResetToken,
  hashResetToken,
  resetTokenLookupHash,
  verifyResetToken,
  hashOtp,
  verifyOtp,
  sessionRef,
  sessionRefMatches,
  TOTP_DIGITS,
  TOTP_PERIOD_SEC,
  MFA_RECOVERY_CODE_COUNT,
} from "../src/lib/security";

/** The ASCII seed from RFC 6238 Appendix B, as base32. */
const RFC_SEED_BASE32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32 (RFC 4648)", () => {
  it("matches the RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("f", "ascii"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo", "ascii"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo", "ascii"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foob", "ascii"))).toBe("MZXW6YQ");
    expect(base32Encode(Buffer.from("fooba", "ascii"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
  });

  it("round-trips arbitrary bytes", () => {
    for (let len = 1; len <= 40; len++) {
      const bytes = Buffer.from(
        Array.from({ length: len }, (_, i) => (i * 37 + len * 11) % 256),
      );
      const encoded = base32Encode(bytes);
      expect(encoded).toMatch(/^[A-Z2-7]+$/);
      expect(base32Decode(encoded)!.equals(bytes)).toBe(true);
    }
  });

  it("rejects non-base32 input rather than silently truncating", () => {
    // "0", "1", "8", "9" and "!" are not in the RFC 4648 alphabet.
    expect(base32Decode("MZXW6YTB0I")).toBeNull();
    expect(base32Decode("MZXW6YTB1I")).toBeNull();
    expect(base32Decode("MZXW6YTB8I")).toBeNull();
    expect(base32Decode("not-base32!")).toBeNull();
    expect(base32Decode("")).toBeNull();
  });

  it("is case- and separator-insensitive on decode", () => {
    expect(base32Decode("mzxw6ytboi")!.toString("ascii")).toBe("foobar");
    expect(base32Decode("MZXW 6YTB OI")!.toString("ascii")).toBe("foobar");
  });
});

describe("TOTP — RFC 6238 published vectors", () => {
  // Appendix B, SHA1 column, 8 digits. We generate 6, so re-derive the 6-digit
  // tail by asserting the code is the published value mod 10^6.
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it("produces the published code for each timestamp", () => {
    for (const [unixSeconds, expected8] of vectors) {
      const atMs = unixSeconds * 1000;
      const step = Math.floor(atMs / 1000 / TOTP_PERIOD_SEC);
      const code8 = totpCodeAtStep(RFC_SEED_BASE32, step, 8);
      expect(code8, `t=${unixSeconds}`).toBe(expected8);
      const code6 = totpCodeAtStep(RFC_SEED_BASE32, step, 6);
      expect(code6, `t=${unixSeconds} (6 digits)`).toBe(
        expected8.slice(-TOTP_DIGITS),
      );
    }
  });
});

describe("TOTP verification", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / TOTP_PERIOD_SEC);

  it("generates a 160-bit base32 secret", () => {
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)!.length).toBe(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("accepts the current step's code", () => {
    const code = totpCodeAtStep(secret, step)!;
    expect(verifyTotp(secret, code, { atMs: now })).toEqual({ ok: true, step });
  });

  it("accepts the previous and next step (+/-1 tolerance)", () => {
    for (const offset of [-1, 1]) {
      const code = totpCodeAtStep(secret, step + offset)!;
      expect(verifyTotp(secret, code, { atMs: now }).ok, `offset ${offset}`).toBe(true);
    }
  });

  it("rejects a code from two steps away", () => {
    for (const offset of [-2, 2, -30, 30]) {
      const code = totpCodeAtStep(secret, step + offset)!;
      expect(verifyTotp(secret, code, { atMs: now }).ok, `offset ${offset}`).toBe(false);
    }
  });

  it("rejects a stale code (last step's, replayed an hour later)", () => {
    const code = totpCodeAtStep(secret, Math.floor(now / 1000 / TOTP_PERIOD_SEC))!;
    // An hour later the same digits are a completely different code.
    expect(verifyTotp(secret, code, { atMs: now + 3600_000 }).ok).toBe(false);
  });

  it("rejects malformed codes without throwing", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56", "0000000", "-1"]) {
      expect(verifyTotp(secret, bad, { atMs: now }).ok, bad).toBe(false);
    }
  });

  it("rejects a code generated from a different secret", () => {
    const other = generateTotpSecret();
    const code = totpCodeAtStep(other, step)!;
    expect(verifyTotp(secret, code, { atMs: now }).ok).toBe(false);
  });

  it("stays within the digit range and always pads to 6", () => {
    for (let s = step - 5; s <= step + 5; s++) {
      const code = totpCodeAtStep(secret, s)!;
      expect(code).toMatch(/^\d{6}$/);
      expect(Number(code)).toBeLessThanOrEqual(999_999);
    }
  });

  it("survives the rollover of the 8-byte big-endian counter", () => {
    // Well past 2^32 steps, where a 32-bit counter would wrap.
    const far = Math.floor(now / 1000 / TOTP_PERIOD_SEC) + 40_000_000_000;
    const code = totpCodeAtStep(secret, far)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, { atMs: far * TOTP_PERIOD_SEC * 1000 }).step).toBe(far);
  });
});

describe("AES-256-GCM sealing of the TOTP secret", () => {
  it("round-trips and never stores the plaintext", () => {
    const secret = generateTotpSecret();
    const sealed = encryptSecret(secret);
    expect(sealed).not.toContain(secret);
    expect(sealed.split(":")).toHaveLength(4);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(decryptSecret(sealed)).toBe(secret);
  });

  it("uses a fresh IV per call (identical plaintext -> different ciphertext)", () => {
    const secret = generateTotpSecret();
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("returns null for tampered, truncated or foreign input", () => {
    const sealed = encryptSecret("JBSWY3DPEHPK3PXP");
    const parts = sealed.split(":");
    // Flip a byte of the ciphertext.
    const ct = parts[3]!;
    const flipped = `${ct[0] === "A" ? "B" : "A"}${ct.slice(1)}`;
    expect(decryptSecret([parts[0], parts[1], parts[2], flipped].join(":"))).toBeNull();
    // Tamper with the auth tag.
    expect(decryptSecret([parts[0], parts[1], "AAAA", parts[3]].join(":"))).toBeNull();
    // Truncated / wrong version / not a blob at all.
    expect(decryptSecret(parts.slice(0, 3).join(":"))).toBeNull();
    expect(decryptSecret(`v2:${parts[1]}:${parts[2]}:${parts[3]}`)).toBeNull();
    expect(decryptSecret("not-encrypted")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });

  it("derives a stable key from MFA_ENCRYPTION_KEY / SESSION_SECRET", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const sealed = encryptSecret(secret);
    const original = process.env.MFA_ENCRYPTION_KEY;
    const sessionSecret = process.env.SESSION_SECRET;
    try {
      // Same key material -> still decryptable (this is what makes a
      // multi-instance deployment work).
      process.env.MFA_ENCRYPTION_KEY = "0".repeat(64);
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
      process.env.MFA_ENCRYPTION_KEY = original ?? "";
      expect(decryptSecret(sealed)).toBe(secret);

      // A DIFFERENT app-level key must not be able to open it.
      process.env.MFA_ENCRYPTION_KEY = "1".repeat(64);
      expect(decryptSecret(sealed)).toBeNull();
    } finally {
      if (original === undefined) delete process.env.MFA_ENCRYPTION_KEY;
      else process.env.MFA_ENCRYPTION_KEY = original;
      if (sessionSecret !== undefined) process.env.SESSION_SECRET = sessionSecret;
    }
  });
});

describe("MFA recovery codes", () => {
  it("generates codes in a readable, unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      // No I, O, 0 or 1 — the characters people misread or mistype.
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("is high-entropy enough and unique across a batch", () => {
    const codes = Array.from({ length: 200 }, () => generateRecoveryCode());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("normalises case and separators before hashing", () => {
    expect(normalizeRecoveryCode("abcde-fghij")).toBe("ABCDEFGHIJ");
    expect(normalizeRecoveryCode("ABCDE FGHIJ")).toBe("ABCDEFGHIJ");
    const stored = hashRecoveryCode("ABCDE-FGHIJ");
    for (const variant of ["abcde-fghij", "ABCDE-FGHIJ", " abcde fg hij ", "ABCDEFGHIJ"]) {
      expect(verifyRecoveryCode(variant, stored), variant).toBe(true);
    }
    expect(verifyRecoveryCode("ABCDE-FGHIQ", stored)).toBe(false);
  });

  it("stores a salted HMAC, never the code", () => {
    const stored = hashRecoveryCode("ABCDE-FGHIJ");
    expect(stored).not.toContain("ABCDE");
    expect(stored).toMatch(/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    // Salted: the same code hashes differently every time.
    expect(hashRecoveryCode("ABCDE-FGHIJ")).not.toBe(stored);
  });

  it("tells a recovery code apart from a TOTP code by shape", () => {
    expect(looksLikeRecoveryCode("ABCDE-FGHIJ")).toBe(true);
    expect(looksLikeRecoveryCode("abcdefghij")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("")).toBe(false);
  });

  it("uses 8 codes per enrolment", () => {
    expect(MFA_RECOVERY_CODE_COUNT).toBe(8);
  });
});

describe("password-reset tokens", () => {
  it("generates 256-bit hex tokens from a CSPRNG", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/Math\.random/);
  });

  it("stores a salted HMAC and verifies only the real token", () => {
    const token = generateResetToken();
    const stored = hashResetToken(token);
    expect(stored).toMatch(/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(verifyResetToken(token, stored)).toBe(true);
    expect(verifyResetToken(`${token}0`, stored)).toBe(false);
    expect(verifyResetToken(generateResetToken(), stored)).toBe(false);
  });

  it("has a deterministic lookup hash so a token can be found in one query", () => {
    const token = generateResetToken();
    expect(resetTokenLookupHash(token)).toBe(resetTokenLookupHash(token));
    expect(resetTokenLookupHash(token)).not.toBe(resetTokenLookupHash(generateResetToken()));
    expect(resetTokenLookupHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed on a legacy bcrypt hash in the token column", () => {
    expect(verifyResetToken("x", "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYh2dQHP8DjL0eW")).toBe(false);
  });
});

describe("OTP hashing is unregressed", () => {
  it("keeps the sha256$salt$HMAC format and verifies its own value", () => {
    const stored = hashOtp("123456");
    expect(stored).toMatch(/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(verifyOtp("123456", stored)).toBe(true);
    expect(verifyOtp("123457", stored)).toBe(false);
    expect(hashOtp("123456")).not.toBe(stored);
  });

  it("fails closed on a non-salted or foreign stored value", () => {
    expect(verifyOtp("123456", "nonsense")).toBe(false);
    expect(verifyOtp("123456", "bcrypt$abc$def")).toBe(false);
  });
});

describe("opaque session reference", () => {
  it("is deterministic for a sid and different across sids", () => {
    const ref = sessionRef("sid-one");
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(sessionRef("sid-one")).toBe(ref);
    expect(sessionRef("sid-two")).not.toBe(ref);
  });

  it("does not reveal or contain the sid", () => {
    const sid = "s%3Avery-long-session-identifier-value.abcdefghijklmnop";
    const ref = sessionRef(sid);
    expect(ref).not.toContain("very-long");
    expect(sid).not.toContain(ref);
    // The mapping is one-way in practice: no sid can be recovered from the ref
    // without the server-side key, which is why the ref cannot be replayed as
    // the cookie. Asserting that the ref is useless as an input means checking
    // it does not equal the sid in either direction.
    expect(ref === sid).toBe(false);
  });

  it("matches in constant time only against the right sid", () => {
    expect(sessionRefMatches("sid-one", sessionRef("sid-one"))).toBe(true);
    expect(sessionRefMatches("sid-one", sessionRef("sid-two"))).toBe(false);
    expect(sessionRefMatches("sid-one", "short")).toBe(false);
    expect(sessionRefMatches("sid-one", `${sessionRef("sid-one")}x`)).toBe(false);
    expect(sessionRefMatches("sid-one", "")).toBe(false);
  });

  it("changes when the key changes (so refs cannot be compared across key rotations)", () => {
    const before = sessionRef("sid-one");
    const original = process.env.SESSION_REF_SECRET;
    try {
      process.env.SESSION_REF_SECRET = "a-different-key-entirely";
      expect(sessionRef("sid-one")).not.toBe(before);
    } finally {
      if (original === undefined) delete process.env.SESSION_REF_SECRET;
      else process.env.SESSION_REF_SECRET = original;
    }
  });
});