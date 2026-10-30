/**
 * Browser pairing: how a web app that talks to a local or self-hosted engine
 * directly obtains its own client credentials, without a secret baked into
 * its bundle. See docs/services/pairing.md.
 *
 * 1. The browser makes a verifier (`newPairingVerifier`), keeps it in memory,
 *    and calls `startPairing` on the unauthenticated gateway with a
 *    description and the verifier's hash. The engine binds the pairing to the
 *    request's `Origin` and answers with a user code.
 * 2. The browser shows the code. The operator types it into a surface that is
 *    already a client (`lookupPairing`), checks the origin it shows, and
 *    approves or denies it (`decidePairing`).
 * 3. The browser polls `claimPairing` with the verifier. Once approved, the
 *    answer carries a new client id and secret, exactly once.
 *
 * The user code is a correlation id, not a credential: approving needs an
 * authenticated client, and collecting the credentials needs the verifier.
 */

/**
 * The user code alphabet: no vowels, so no words, and none of 0/O/1/I/L,
 * which read alike. Must match the companion pairing code alphabet.
 */
export const PAIRING_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";

/** Characters in a user code, shown as two groups of four. */
export const PAIRING_CODE_LENGTH = 8;

/**
 * A user code as typed, in its stored form: separators and spaces dropped,
 * upper-cased. Null when what is left is not a code.
 */
export function normalizePairingCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  if (code.length !== PAIRING_CODE_LENGTH) {
    return null;
  }
  for (const char of code) {
    if (!PAIRING_CODE_ALPHABET.includes(char)) {
      return null;
    }
  }
  return code;
}

/** A stored user code as shown: `ABCD-EFGH`. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, PAIRING_CODE_LENGTH / 2)}-${code.slice(PAIRING_CODE_LENGTH / 2)}`;
}

/**
 * A verifier is a PKCE code verifier (RFC 7636): 43 to 128 characters of
 * base64url. `newPairingVerifier` makes one from 32 random bytes.
 */
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;

/** A verifier hash is base64url SHA-256 with no padding: 43 characters. */
const VERIFIER_HASH = /^[A-Za-z0-9_-]{43}$/;

export function isPairingVerifier(value: unknown): value is string {
  return typeof value === "string" && VERIFIER.test(value);
}

export function isPairingVerifierHash(value: unknown): value is string {
  return typeof value === "string" && VERIFIER_HASH.test(value);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new verifier from 32 bytes of `crypto.getRandomValues`. Keep it in memory only. */
export function newPairingVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The hash `startPairing` takes: base64url(SHA-256(ASCII(verifier))), PKCE's S256. */
export async function pairingVerifierHash(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The longest description a pairing may carry, in characters. */
export const PAIRING_DESCRIPTION_MAX_LENGTH = 64;

export interface StartPairingRequest {
  /** What the operator sees, such as "Chrome on Windows". 1 to 64 characters, no control characters. */
  description: string;
  /** `pairingVerifierHash(verifier)`. */
  verifierHash: string;
}

/** A pairing the engine started, as the browser holds it. */
export interface StartedPairing {
  pairingId: string;
  /** Eight characters with no separator; show it with `formatPairingCode`. */
  userCode: string;
  /** ISO 8601. After this the pairing is gone and the browser starts a new one. */
  expiresAt: string;
  /** How long to wait between `claimPairing` calls. */
  pollIntervalMs: number;
}

/**
 * Why a pairing could not start.
 *
 * - `not_available`: this engine does not offer pairing (it is neither a
 *   local nor a self-hosted engine).
 * - `origin_refused`: the request had no usable `Origin`, or one that may not
 *   pair: only `https:` origins, and `http:` on a loopback host, may.
 * - `invalid_request`: the description or the verifier hash is malformed.
 * - `rate_limited`: too many pairings were started recently; retry after
 *   `retryAfterMs`.
 * - `too_many_pending`: too many pairings are waiting for approval.
 */
export type StartPairingErrorCode =
  | "not_available"
  | "origin_refused"
  | "invalid_request"
  | "rate_limited"
  | "too_many_pending";

export type StartPairingResponse =
  | { ok: true; pairing: StartedPairing }
  | { ok: false; code: StartPairingErrorCode; error: string; retryAfterMs?: number };

export interface ClaimPairingRequest {
  pairingId: string;
  verifier: string;
}

/**
 * Where a pairing stands for the browser that started it.
 *
 * - `pending`: not decided yet; poll again after the interval.
 * - `slow_down`: polled too soon; wait `pollIntervalMs`, which has grown.
 * - `approved`: here are the credentials. They are not given again.
 * - `denied`: the operator refused.
 * - `expired`: no decision before the pairing expired.
 * - `not_found`: no such pairing for this browser. This also answers a wrong
 *   verifier or origin, so a guess learns nothing.
 * - `failed`: the engine could not create the client; retry when `retryable`.
 */
export type ClaimPairingResponse =
  | { status: "pending" }
  | { status: "slow_down"; pollIntervalMs: number }
  | { status: "approved"; credentials: { clientId: string; clientSecret: string } }
  | { status: "denied" | "expired" | "not_found" }
  | { status: "failed"; retryable: boolean; error: string };

export interface CancelPairingRequest {
  pairingId: string;
  verifier: string;
}

export type CancelPairingResponse = { ok: true } | { ok: false; code: "not_available" | "not_found" };

/** A pairing waiting for, or past, the operator's decision, as an approver sees it. */
export interface PendingPairing {
  pairingId: string;
  /** The web origin the browser paired from. Show it to the operator before they decide. */
  origin: string;
  description: string;
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601. */
  expiresAt: string;
  status: "pending" | "approved";
}

export interface LookupPairingRequest {
  /** As typed; normalized with `normalizePairingCode`. */
  userCode: string;
}

export type LookupPairingResponse =
  | { ok: true; pairing: PendingPairing }
  | { ok: false; code: "not_available" | "not_found" | "invalid_code" };

export interface DecidePairingRequest {
  pairingId: string;
  decision: "approve" | "deny";
}

export type DecidePairingResponse =
  | { ok: true }
  | { ok: false; code: "not_available" | "not_found" | "expired" | "already_decided" };

export type ListPendingPairingsResponse =
  | { ok: true; pairings: PendingPairing[] }
  | { ok: false; code: "not_available" };
