import { randomBytes } from "node:crypto";
import {
  type CancelPairingRequest,
  type CancelPairingResponse,
  type ClaimPairingRequest,
  type ClaimPairingResponse,
  type DecidePairingRequest,
  type DecidePairingResponse,
  isPairingVerifier,
  isPairingVerifierHash,
  type ListPendingPairingsResponse,
  type LookupPairingRequest,
  type LookupPairingResponse,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_DESCRIPTION_MAX_LENGTH,
  type PendingPairing,
  pairingVerifierHash,
  type StartPairingRequest,
  type StartPairingResponse,
} from "@woofx3/api/pairing";
import type { ClientPairingStartedEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import { comparableOriginOf } from "@woofx3/common/http/request-guard";
import { secretsMatch } from "@woofx3/common/http/secrets";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db-client";
import { type PairingConfig, validatePairingConfig } from "./pairing-config";

/** How many user codes to draw before deciding the random source is broken. */
const USER_CODE_ATTEMPTS = 16;

/** The window the start rate limits count over. */
const RATE_WINDOW_MS = 60_000;

/** Hosts a plain `http:` origin may pair from: the traffic never leaves the machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The desktop app's own window, on Windows; it registers rather than pairs. */
const APP_HOSTS = new Set(["tauri.localhost"]);

/** Creates the client a claimed pairing becomes. */
export type CreatePairedClient = (request: {
  description: string;
  origin: string;
}) => Promise<{ clientId: string; clientSecret: string }>;

/** Creates paired clients through db-proxy, which owns clients. */
export function pairedClientCreator(db: Pick<DbClient, "createClient">): CreatePairedClient {
  return async ({ description, origin }) => {
    const resp = await db.createClient({
      description,
      callbackUrl: "",
      callbackToken: "",
      kind: "CLIENT_KIND_PAIRED",
      origin,
    });
    if (!resp.client?.clientId || !resp.client.clientSecret) {
      throw new Error(`db-proxy created no paired client: ${resp.status?.message ?? "no client in its answer"}`);
    }
    return { clientId: resp.client.clientId, clientSecret: resp.client.clientSecret };
  };
}

export interface PairingRegistryOptions {
  config: PairingConfig;
  logger: SharedLogger;
  createPairedClient: CreatePairedClient;
  /** Announces a started pairing to the engine's clients. Best effort: it must not throw. */
  emit: (event: ClientPairingStartedEvent) => void;
  now?: () => number;
  newId?: () => string;
  /** `n` random bytes, for the user code. */
  randomBytes?: (n: number) => Uint8Array;
}

type PairingStatus = "pending" | "approved" | "denied" | "claiming";

interface Pairing {
  id: string;
  userCode: string;
  origin: string;
  description: string;
  verifierHash: string;
  startedAtMs: number;
  expiresAtMs: number;
  status: PairingStatus;
  pollIntervalMs: number;
  lastPollAtMs: number | null;
  failedClaims: number;
}

/**
 * The origin `origin` (an `Origin` header) may pair as, in comparable form,
 * or null when it may not pair: absent, opaque (`null`), not a URL, or
 * anything but `https:` and loopback `http:`. A plain-http origin on another
 * host would carry the secret across the network in clear, and an app
 * origin such as `tauri://localhost` is the desktop shell's, which
 * registers rather than pairs.
 */
export function pairingOriginOf(origin: string | null): string | null {
  if (origin === null) {
    return null;
  }
  const comparable = comparableOriginOf(origin);
  if (comparable === null) {
    return null;
  }
  const url = new URL(comparable);
  if (APP_HOSTS.has(url.hostname)) {
    return null;
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    return comparable;
  }
  return null;
}

/** Whether `description` is 1 to 64 characters with no control characters. */
function isDescription(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= PAIRING_DESCRIPTION_MAX_LENGTH &&
    !/\p{Cc}/u.test(value)
  );
}

/**
 * Starts counted in a sliding window, so a limit of N a minute admits N
 * starts in any 60 seconds and says when the next one is allowed.
 */
class StartWindow {
  private starts: number[] = [];

  constructor(private readonly limit: number) {}

  /** Milliseconds until a start is allowed at `now`, or 0 when it is. */
  waitAt(now: number): number {
    this.prune(now);
    if (this.starts.length < this.limit) {
      return 0;
    }
    return this.starts[0] + RATE_WINDOW_MS - now;
  }

  record(now: number): void {
    this.starts.push(now);
  }

  /** Whether the window holds nothing, so it can be forgotten. */
  emptyAt(now: number): boolean {
    this.prune(now);
    return this.starts.length === 0;
  }

  private prune(now: number): void {
    while (this.starts.length > 0 && this.starts[0] + RATE_WINDOW_MS <= now) {
      this.starts.shift();
    }
  }
}

/**
 * The engine's browser pairings, held in the api's memory.
 *
 * A pairing is a request waiting a few minutes for a human, not a record:
 * the client it may become is created through db-proxy, which owns clients,
 * only when the browser claims it. An api restart forgets every pairing, and
 * the browser, which polls, starts another. Nothing here outlives `ttlMs`,
 * and `maxPending` bounds what is held, so no sweeper runs: expiry is checked
 * whenever a pairing is touched.
 *
 * Every refusal to an unauthenticated caller is a result, since an RPC error
 * carries only its message, and a wrong verifier or origin answers exactly
 * as a pairing that does not exist.
 */
export class PairingRegistry {
  private pairings = new Map<string, Pairing>();
  private globalStarts: StartWindow;
  private originStarts = new Map<string, StartWindow>();
  private readonly config: PairingConfig;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly randomBytes: (n: number) => Uint8Array;

  constructor(private readonly opts: PairingRegistryOptions) {
    this.config = validatePairingConfig(opts.config);
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.randomBytes = opts.randomBytes ?? ((n) => new Uint8Array(randomBytes(n)));
    this.globalStarts = new StartWindow(this.config.startsPerMinute);
  }

  /** Start a pairing for the browser at `requestOrigin`, the `Origin` header of the request that carried it. */
  async start(request: StartPairingRequest, requestOrigin: string | null): Promise<StartPairingResponse> {
    const origin = pairingOriginOf(requestOrigin);
    if (origin === null) {
      this.opts.logger.warn("Refused a pairing from an origin that may not pair", { origin: requestOrigin });
      return {
        ok: false,
        code: "origin_refused",
        error: "pairing needs a browser page served over https, or over http from this computer",
      };
    }
    if (!isDescription(request?.description) || !isPairingVerifierHash(request?.verifierHash)) {
      return {
        ok: false,
        code: "invalid_request",
        error: `description must be 1 to ${PAIRING_DESCRIPTION_MAX_LENGTH} characters with no control characters, and verifierHash a base64url SHA-256`,
      };
    }

    const now = this.now();
    this.pruneExpired(now);
    const retryAfterMs = Math.max(this.globalStarts.waitAt(now), this.originWindow(origin).waitAt(now));
    if (retryAfterMs > 0) {
      this.opts.logger.warn("Refused a pairing over the start rate limit", { origin, retryAfterMs });
      return { ok: false, code: "rate_limited", error: "too many pairings were started recently", retryAfterMs };
    }
    const fromOrigin = [...this.pairings.values()].filter((pairing) => pairing.origin === origin).length;
    if (this.pairings.size >= this.config.maxPending || fromOrigin >= this.config.maxPendingPerOrigin) {
      this.opts.logger.warn("Refused a pairing: too many are waiting", { origin, pending: this.pairings.size });
      return { ok: false, code: "too_many_pending", error: "too many pairings are waiting for approval" };
    }

    this.globalStarts.record(now);
    this.originWindow(origin).record(now);
    const pairing: Pairing = {
      id: this.newId(),
      userCode: this.newUserCode(),
      origin,
      description: request.description.trim(),
      verifierHash: request.verifierHash,
      startedAtMs: now,
      expiresAtMs: now + this.config.ttlMs,
      status: "pending",
      pollIntervalMs: this.config.pollIntervalMs,
      lastPollAtMs: null,
      failedClaims: 0,
    };
    this.pairings.set(pairing.id, pairing);
    const expiresAt = new Date(pairing.expiresAtMs).toISOString();
    // The user code is a correlation id, not a credential: approving needs a
    // client of this engine. A headless operator reads it from this line.
    this.opts.logger.info("Pairing started", {
      pairingId: pairing.id,
      origin,
      description: pairing.description,
      userCode: pairing.userCode,
      expiresAt,
    });
    this.opts.emit({
      type: EngineEventType.CLIENT_PAIRING_STARTED,
      pairingId: pairing.id,
      origin,
      description: pairing.description,
      expiresAt,
    });
    return {
      ok: true,
      pairing: { pairingId: pairing.id, userCode: pairing.userCode, expiresAt, pollIntervalMs: pairing.pollIntervalMs },
    };
  }

  /**
   * The browser's poll. Once the pairing is approved, the first claim from
   * the start origin with the right verifier creates the client and returns
   * its credentials; the pairing is then gone.
   */
  async claim(request: ClaimPairingRequest, requestOrigin: string | null): Promise<ClaimPairingResponse> {
    const now = this.now();
    const found = await this.ownPairing(request, requestOrigin, now);
    if (found.kind !== "found") {
      return { status: found.kind };
    }
    const pairing = found.pairing;

    if (pairing.lastPollAtMs !== null && now - pairing.lastPollAtMs < pairing.pollIntervalMs) {
      pairing.pollIntervalMs += this.config.slowDownStepMs;
      pairing.lastPollAtMs = now;
      return { status: "slow_down", pollIntervalMs: pairing.pollIntervalMs };
    }
    pairing.lastPollAtMs = now;

    switch (pairing.status) {
      case "pending":
      case "claiming":
        return { status: "pending" };
      case "denied":
        this.pairings.delete(pairing.id);
        return { status: "denied" };
      case "approved":
        return this.createClient(pairing);
    }
  }

  /** The browser gives up its pairing. */
  async cancel(request: CancelPairingRequest, requestOrigin: string | null): Promise<CancelPairingResponse> {
    const found = await this.ownPairing(request, requestOrigin, this.now());
    if (found.kind !== "found" || found.pairing.status === "claiming") {
      return { ok: false, code: "not_found" };
    }
    this.pairings.delete(found.pairing.id);
    this.opts.logger.info("Pairing cancelled by its browser", { pairingId: found.pairing.id });
    return { ok: true };
  }

  /** The pairing a browser shows `userCode` for, for an approver. */
  lookup(request: LookupPairingRequest): LookupPairingResponse {
    const userCode = typeof request?.userCode === "string" ? normalizePairingCode(request.userCode) : null;
    if (userCode === null) {
      return { ok: false, code: "invalid_code" };
    }
    this.pruneExpired(this.now());
    for (const pairing of this.pairings.values()) {
      if (pairing.userCode === userCode && isListed(pairing)) {
        return { ok: true, pairing: toPendingPairing(pairing) };
      }
    }
    return { ok: false, code: "not_found" };
  }

  /** Approve or deny a pending pairing. `approverClientId` is the deciding client, for the log. */
  decide(request: DecidePairingRequest, approverClientId: string): DecidePairingResponse {
    const pairing = typeof request?.pairingId === "string" ? this.pairings.get(request.pairingId) : undefined;
    if (!pairing || (request.decision !== "approve" && request.decision !== "deny")) {
      return { ok: false, code: "not_found" };
    }
    if (this.expire(pairing, this.now())) {
      return { ok: false, code: "expired" };
    }
    if (pairing.status !== "pending") {
      return { ok: false, code: "already_decided" };
    }
    pairing.status = request.decision === "approve" ? "approved" : "denied";
    this.opts.logger.info(request.decision === "approve" ? "Pairing approved" : "Pairing denied", {
      pairingId: pairing.id,
      origin: pairing.origin,
      description: pairing.description,
      approverClientId,
    });
    return { ok: true };
  }

  /** Every pairing waiting for a decision or a claim. */
  listPending(): ListPendingPairingsResponse {
    this.pruneExpired(this.now());
    return { ok: true, pairings: [...this.pairings.values()].filter(isListed).map(toPendingPairing) };
  }

  /**
   * The pairing `request` names, if it belongs to the caller: same origin as
   * its start, and the verifier its start committed to. A mismatch counts
   * against the pairing and answers `not_found`, as a pairing that does not
   * exist does, so neither a pairing id nor a user code seen elsewhere helps.
   */
  private async ownPairing(
    request: { pairingId: string; verifier: string },
    requestOrigin: string | null,
    now: number
  ): Promise<{ kind: "found"; pairing: Pairing } | { kind: "not_found" | "expired" }> {
    const pairing = typeof request?.pairingId === "string" ? this.pairings.get(request.pairingId) : undefined;
    if (!pairing) {
      return { kind: "not_found" };
    }
    const presentedHash = isPairingVerifier(request.verifier) ? await pairingVerifierHash(request.verifier) : null;
    // The hash was awaited: the pairing may have been claimed, cancelled or
    // forgotten meanwhile, and a stale copy must not be acted on.
    if (this.pairings.get(pairing.id) !== pairing) {
      return { kind: "not_found" };
    }
    const verified = presentedHash !== null && secretsMatch(pairing.verifierHash, presentedHash);
    if (!verified || pairingOriginOf(requestOrigin) !== pairing.origin) {
      pairing.failedClaims += 1;
      this.opts.logger.warn("Refused a pairing claim with a wrong verifier or origin", {
        pairingId: pairing.id,
        origin: requestOrigin,
        failedClaims: pairing.failedClaims,
      });
      if (pairing.failedClaims >= this.config.claimFailuresBeforeCancel && pairing.status !== "claiming") {
        this.pairings.delete(pairing.id);
        this.opts.logger.warn("Pairing cancelled after repeated wrong claims", { pairingId: pairing.id });
      }
      return { kind: "not_found" };
    }
    // Only after the caller proved the pairing is theirs, so expiry tells a
    // stranger nothing either.
    if (this.expire(pairing, now)) {
      return { kind: "expired" };
    }
    return { kind: "found", pairing };
  }

  /**
   * Create the paired client. The pairing is marked `claiming` before the
   * db-proxy call, in the same turn as the check, so a second claim meanwhile
   * cannot create a second client; it is deleted once the client exists.
   */
  private async createClient(pairing: Pairing): Promise<ClaimPairingResponse> {
    pairing.status = "claiming";
    let credentials: { clientId: string; clientSecret: string };
    try {
      credentials = await this.opts.createPairedClient({ description: pairing.description, origin: pairing.origin });
    } catch (err) {
      pairing.status = "approved";
      const error = err instanceof Error ? err.message : String(err);
      this.opts.logger.error("Could not create a paired client", { pairingId: pairing.id, error });
      return { status: "failed", retryable: true, error };
    }
    this.pairings.delete(pairing.id);
    this.opts.logger.info("Pairing claimed", {
      pairingId: pairing.id,
      clientId: credentials.clientId,
      origin: pairing.origin,
    });
    return { status: "approved", credentials };
  }

  /** Forget `pairing` if it has expired, and say whether it had. One being claimed finishes its claim. */
  private expire(pairing: Pairing, now: number): boolean {
    if (now < pairing.expiresAtMs || pairing.status === "claiming") {
      return false;
    }
    this.pairings.delete(pairing.id);
    this.opts.logger.info("Pairing expired", { pairingId: pairing.id, status: pairing.status });
    return true;
  }

  private pruneExpired(now: number): void {
    for (const pairing of [...this.pairings.values()]) {
      this.expire(pairing, now);
    }
    for (const [origin, window] of this.originStarts) {
      if (window.emptyAt(now)) {
        this.originStarts.delete(origin);
      }
    }
  }

  private originWindow(origin: string): StartWindow {
    let window = this.originStarts.get(origin);
    if (!window) {
      window = new StartWindow(this.config.startsPerOriginPerMinute);
      this.originStarts.set(origin, window);
    }
    return window;
  }

  /**
   * A user code no waiting pairing has. Each character is drawn by rejection
   * sampling, so every one of the alphabet is equally likely.
   */
  private newUserCode(): string {
    const accepted = Math.floor(256 / PAIRING_CODE_ALPHABET.length) * PAIRING_CODE_ALPHABET.length;
    // With at most `maxPending` codes in use out of 27^8, a repeat is all but
    // impossible; a source that keeps repeating is broken.
    for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt++) {
      let code = "";
      while (code.length < PAIRING_CODE_LENGTH) {
        for (const byte of this.randomBytes(PAIRING_CODE_LENGTH)) {
          if (byte < accepted && code.length < PAIRING_CODE_LENGTH) {
            code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
          }
        }
      }
      if (![...this.pairings.values()].some((pairing) => pairing.userCode === code)) {
        return code;
      }
    }
    throw new Error(`no unused pairing code in ${USER_CODE_ATTEMPTS} draws: the random source is not random`);
  }
}

/** Whether an approver sees `pairing`: one denied is waiting only for its browser to learn so. */
function isListed(pairing: Pairing): boolean {
  return pairing.status === "pending" || pairing.status === "approved";
}

function toPendingPairing(pairing: Pairing): PendingPairing {
  return {
    pairingId: pairing.id,
    origin: pairing.origin,
    description: pairing.description,
    startedAt: new Date(pairing.startedAtMs).toISOString(),
    expiresAt: new Date(pairing.expiresAtMs).toISOString(),
    status: pairing.status === "approved" ? "approved" : "pending",
  };
}
