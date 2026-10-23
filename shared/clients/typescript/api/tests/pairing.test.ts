import { describe, expect, test } from "bun:test";
import {
  formatPairingCode,
  isPairingVerifier,
  isPairingVerifierHash,
  newPairingVerifier,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  pairingVerifierHash,
} from "../pairing";

describe("normalizePairingCode", () => {
  test.each([
    ["BCDF-GHJK", "BCDFGHJK"],
    ["bcdf-ghjk", "BCDFGHJK"],
    ["BCDFGHJK", "BCDFGHJK"],
    [" bcdf ghjk ", "BCDFGHJK"],
    ["2345-6789", "23456789"],
  ])("reads %p as %p", (input, expected) => {
    expect(normalizePairingCode(input)).toBe(expected);
  });

  test.each([
    ["too short", "BCDF-GHJ"],
    ["too long", "BCDF-GHJKM"],
    ["a vowel", "BCDF-GHJA"],
    ["a zero", "BCDF-GHJ0"],
    ["a one", "BCDF-GHJ1"],
    ["an L", "BCDF-GHJL"],
    ["empty", ""],
  ])("refuses %s", (_, input) => {
    expect(normalizePairingCode(input)).toBeNull();
  });
});

test("formatPairingCode shows two groups of four", () => {
  expect(formatPairingCode("BCDFGHJK")).toBe("BCDF-GHJK");
  expect(normalizePairingCode(formatPairingCode("BCDFGHJK"))).toBe("BCDFGHJK");
});

test("the alphabet has no vowels and none of 0, O, 1, I, L", () => {
  expect(PAIRING_CODE_ALPHABET).not.toMatch(/[AEIOU01L]/);
  expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(PAIRING_CODE_ALPHABET.length);
});

describe("verifiers", () => {
  test("a new verifier is a PKCE verifier, and its hash a PKCE S256 challenge", async () => {
    const verifier = newPairingVerifier();
    expect(isPairingVerifier(verifier)).toBe(true);
    expect(isPairingVerifierHash(await pairingVerifierHash(verifier))).toBe(true);
    expect(newPairingVerifier()).not.toBe(verifier);
  });

  test("hashes as RFC 7636's S256 example does", async () => {
    expect(await pairingVerifierHash("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  test.each([
    ["short"],
    ["has spaces in it and is long enough to be a verifier otherwise"],
    [42],
    [null],
  ])("%p is not a verifier", (value) => {
    expect(isPairingVerifier(value)).toBe(false);
  });
});
