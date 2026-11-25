import { describe, expect, test } from "bun:test";
import { LogAccessTokens } from "../src/engine-logs/LogAccessTokens";

const KEY = new Uint8Array(32).fill(7);

function tokens(nowRef: { ms: number }, key = KEY): LogAccessTokens {
  return new LogAccessTokens(key, () => nowRef.ms, { ttlMs: 60_000 });
}

describe("LogAccessTokens", () => {
  test("a fresh token verifies for its own scope only", () => {
    const clock = { ms: 1_000_000 };
    const issuer = tokens(clock);
    const { token, expiresAt } = issuer.issue("stream");
    expect(expiresAt).toBe(new Date(1_060_000).toISOString());
    expect(issuer.verify(token, "stream")).toBe(true);
    expect(issuer.verify(token, "export")).toBe(false);
  });

  test("expires at its deadline", () => {
    const clock = { ms: 1_000_000 };
    const issuer = tokens(clock);
    const { token } = issuer.issue("export");
    clock.ms = 1_059_999;
    expect(issuer.verify(token, "export")).toBe(true);
    clock.ms = 1_060_000;
    expect(issuer.verify(token, "export")).toBe(false);
  });

  test("a token signed with another key does not verify", () => {
    const clock = { ms: 1_000_000 };
    const { token } = tokens(clock, new Uint8Array(32).fill(9)).issue("stream");
    expect(tokens(clock).verify(token, "stream")).toBe(false);
  });

  const malformed = ["", "abc", "a.b.c", ".", "e30.", "e30.AAAA"];
  for (const token of malformed) {
    test(`rejects the malformed token ${JSON.stringify(token)}`, () => {
      expect(tokens({ ms: 1 }).verify(token, "stream")).toBe(false);
    });
  }

  test("a tampered payload does not verify", () => {
    const clock = { ms: 1_000_000 };
    const issuer = tokens(clock);
    const { token } = issuer.issue("stream");
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ scope: "export", exp: 9_999_999_999_999 })).toString("base64url");
    expect(issuer.verify(`${forged}.${signature}`, "export")).toBe(false);
  });

  test("refuses a short key, a non-positive ttl and an unknown scope", () => {
    expect(() => new LogAccessTokens(new Uint8Array(8), Date.now, { ttlMs: 1 })).toThrow("at least 32 bytes");
    expect(() => new LogAccessTokens(KEY, Date.now, { ttlMs: 0 })).toThrow("ttlMs must be positive");
    expect(() => tokens({ ms: 1 }).issue("admin" as never)).toThrow("unknown log access scope");
  });
});
