import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a presented secret equals the expected one. Both sides are hashed
 * first so the comparison takes the same time whatever the presented value's
 * length, and never short-circuits.
 */
export function secretsMatch(expected: string, presented: string): boolean {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const presentedDigest = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}
