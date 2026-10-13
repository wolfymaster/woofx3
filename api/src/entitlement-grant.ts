import { z } from "zod";

/**
 * A signed statement of which gateable features one managed engine may use.
 * The dashboard signs it with a key only it holds; the engine verifies it
 * against the public keys its provisioner configured. Holding the engine's
 * API credentials is not enough to raise a grant: nothing unsigned verifies.
 *
 * Wire format: a compact JWS (`header.payload.signature`, base64url) with
 * `alg: "EdDSA"` over Ed25519. The format is shared with the signer in the
 * dashboard's Convex backend and documented in
 * docs/services/engine-entitlements.md.
 */
export interface EntitlementGrant {
  /** The engine the grant is for: its `WOOFX3_ENGINE_NAME`. */
  aud: string;
  /** Issued at, seconds since the epoch. */
  iat: number;
  /** Expires at, seconds since the epoch. */
  exp: number;
  /** Increases with every grant the signer issues for this engine. */
  seq: number;
  /** Capability ids the engine may use. Ids this build does not know are ignored. */
  grants: string[];
  /** Numeric limits a plan sets, by name. */
  limits: Record<string, number>;
}

export const ENTITLEMENT_GRANT_TYPE = "woofx3-entitlements+jwt";

const HeaderSchema = z.object({
  alg: z.literal("EdDSA"),
  kid: z.string().min(1),
  typ: z.literal(ENTITLEMENT_GRANT_TYPE),
});

const PayloadSchema = z.object({
  aud: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  grants: z.array(z.string()),
  limits: z.record(z.number()).default({}),
});

/** Refused grants carry the reason; the dashboard shows it to an operator. */
export class EntitlementGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementGrantError";
  }
}

/** Ed25519 public keys by key id. */
export type EntitlementPublicKeys = ReadonlyMap<string, CryptoKey>;

/**
 * Parses `WOOFX3_ENTITLEMENT_PUBLIC_KEYS`: comma-separated `kid:key` pairs,
 * each key a raw 32-byte Ed25519 public key in base64url. More than one key
 * lets the signer rotate without a window in which grants fail to verify.
 * Throws on anything malformed: an engine that cannot check grants must not
 * start as if it could.
 */
export async function parseEntitlementPublicKeys(value: string): Promise<EntitlementPublicKeys> {
  const keys = new Map<string, CryptoKey>();
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      throw new Error(`WOOFX3_ENTITLEMENT_PUBLIC_KEYS: expected kid:key, got "${trimmed}"`);
    }
    const kid = trimmed.slice(0, separator);
    if (keys.has(kid)) {
      throw new Error(`WOOFX3_ENTITLEMENT_PUBLIC_KEYS: key id "${kid}" is listed twice`);
    }
    const raw = base64UrlDecode(trimmed.slice(separator + 1));
    if (raw.length !== 32) {
      throw new Error(`WOOFX3_ENTITLEMENT_PUBLIC_KEYS: key "${kid}" is ${raw.length} bytes, expected 32`);
    }
    keys.set(kid, await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]));
  }
  if (keys.size === 0) {
    throw new Error("WOOFX3_ENTITLEMENT_PUBLIC_KEYS lists no keys");
  }
  return keys;
}

/**
 * Verifies a grant's signature and that it is for `audience`. Expiry and
 * ordering are the caller's to judge, since a stored grant is re-read after
 * it has expired.
 */
export async function verifyEntitlementGrant(
  token: string,
  keys: EntitlementPublicKeys,
  audience: string
): Promise<EntitlementGrant> {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    throw new EntitlementGrantError("Not a compact JWS");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = HeaderSchema.safeParse(decodeJsonPart(encodedHeader, "header"));
  if (!header.success) {
    throw new EntitlementGrantError(`Unsupported grant header: ${header.error.issues[0]?.message ?? "invalid"}`);
  }
  const key = keys.get(header.data.kid);
  if (!key) {
    throw new EntitlementGrantError(`Grant signed with unknown key "${header.data.kid}"`);
  }
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, base64UrlDecode(encodedSignature), signed);
  if (!valid) {
    throw new EntitlementGrantError("Grant signature does not verify");
  }
  const payload = PayloadSchema.safeParse(decodeJsonPart(encodedPayload, "payload"));
  if (!payload.success) {
    throw new EntitlementGrantError(`Malformed grant payload: ${payload.error.issues[0]?.message ?? "invalid"}`);
  }
  if (payload.data.aud !== audience) {
    throw new EntitlementGrantError(`Grant is for engine "${payload.data.aud}", not "${audience}"`);
  }
  return payload.data;
}

function decodeJsonPart(encoded: string, part: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  } catch {
    throw new EntitlementGrantError(`Grant ${part} is not base64url JSON`);
  }
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new EntitlementGrantError("Not base64url");
  }
  return new Uint8Array(Buffer.from(value, "base64url"));
}
