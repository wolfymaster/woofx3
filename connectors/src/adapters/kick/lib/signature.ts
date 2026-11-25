import type { Clock } from "../../../host/deps";
import type { KickApi } from "./kick-api";

/** The headers and bytes of one delivery that its signature covers. */
export interface SignedDelivery {
  messageId: string;
  /** `Kick-Event-Message-Timestamp`, exactly as sent. */
  timestamp: string;
  /** `Kick-Event-Signature`: base64 of an RSA PKCS#1 v1.5 SHA-256 signature. */
  signature: string;
  /** The body bytes exactly as Kick sent them. */
  body: Uint8Array;
}

/** `unavailable`: no key could be fetched, so the delivery can be neither accepted nor refused. */
export type SignatureVerdict = "valid" | "invalid" | "unavailable";

export interface KickSignatureVerifierDeps {
  api: Pick<KickApi, "publicKey">;
  clock: Clock;
  /** Kick rotates its key without a key id, so a failed check refetches it, at most this often. */
  publicKeyRefetchMinIntervalMs: number;
}

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/**
 * Checks a webhook delivery against Kick's public key. The signed string is
 * `${messageId}.${timestamp}.${body}` over the raw bytes. The key is fetched
 * once and cached; Kick may rotate it at any time and gives no key id, so a
 * delivery that fails against the cached key is checked again against a
 * freshly fetched one, throttled so forged deliveries cannot make the
 * verifier hammer Kick.
 */
export class KickSignatureVerifier {
  private key: CryptoKey | undefined;
  private fetchedAt: number | undefined;

  constructor(private readonly deps: KickSignatureVerifierDeps) {}

  async verify(delivery: SignedDelivery): Promise<SignatureVerdict> {
    const signature = decodeBase64(delivery.signature);
    if (signature === null) {
      return "invalid";
    }
    const signed = signedBytes(delivery);
    if (this.key !== undefined && (await this.check(signature, signed)) === "valid") {
      return "valid";
    }
    if (!this.mayRefetch()) {
      return this.key === undefined ? "unavailable" : "invalid";
    }
    if (!(await this.refetch())) {
      return "unavailable";
    }
    return this.check(signature, signed);
  }

  private async check(signature: Uint8Array<ArrayBuffer>, signed: Uint8Array<ArrayBuffer>): Promise<SignatureVerdict> {
    const key = this.key;
    if (key === undefined) {
      return "unavailable";
    }
    return (await crypto.subtle.verify(ALGORITHM, key, signature, signed)) ? "valid" : "invalid";
  }

  private mayRefetch(): boolean {
    return (
      this.fetchedAt === undefined || this.deps.clock.now() - this.fetchedAt >= this.deps.publicKeyRefetchMinIntervalMs
    );
  }

  /** Fetches and imports the key; false when Kick did not give a usable one. */
  private async refetch(): Promise<boolean> {
    this.fetchedAt = this.deps.clock.now();
    const pem = await this.deps.api.publicKey();
    if (!pem.ok) {
      return false;
    }
    const der = pemToDer(pem.value);
    if (der === null) {
      return false;
    }
    try {
      this.key = await crypto.subtle.importKey("spki", der, ALGORITHM, false, ["verify"]);
    } catch {
      // A key WebCrypto cannot import is no key: deliveries stay unverifiable until Kick serves a good one.
      return false;
    }
    return true;
  }
}

function signedBytes(delivery: SignedDelivery): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(`${delivery.messageId}.${delivery.timestamp}.`);
  const bytes = new Uint8Array(prefix.length + delivery.body.length);
  bytes.set(prefix, 0);
  bytes.set(delivery.body, prefix.length);
  return bytes;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> | null {
  const match = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(pem);
  if (match?.[1] === undefined) {
    return null;
  }
  return decodeBase64(match[1].replace(/\s+/g, ""));
}
