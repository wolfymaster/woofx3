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
  /**
   * Whether an origin is on the engine's own origin list
   * (`WOOFX3_ALLOWED_ORIGINS`); false for every origin when none is set.
   * See `admitPairingOrigin`.
   */
  isListedOrigin: (origin: string) => boolean;
  /**
   * Whether loopback origins may pair unlisted. True only for the desktop
   * engine (`WOOFX3_HOSTING=local`), which listens on loopback alone, so a
   * page on localhost runs on the engine's own machine. See
   * `admitPairingOrigin`.
   */
  loopbackPairsUnlisted: boolean;
  /** `n` random bytes, for the user code. */
  randomBytes?: (n: number) => Uint8Array;
}

type PairingStatus = "pending" | "approved" | "claiming";

/**
 * What is kept of a denied pairing so its browser can still learn it was
 * denied. A denied pairing leaves the pairings at once, so denying frees its
 * slot for a legitimate browser.
 */
interface Denial {
  origin: string;
  verifierHash: string;
  expiresAtMs: number;
}

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

/** Whether an `Origin` may pair, and the comparable origin it pairs as. */
export type PairingOriginAdmission = { ok: true; origin: string } | { ok: false; error: string };

/**
 * Whether the page at `origin` (an `Origin` header) may pair, given
 * `isListed`, which says whether an origin is on the engine's own origin list
 * (`WOOFX3_ALLOWED_ORIGINS`; false for every origin when it is unset).
 *
 * A loopback origin (`localhost`, `127.0.0.1`, `[::1]`) names the browser's
 * machine, not the engine's. Only when `loopbackPairsUnlisted` holds, on a
 * desktop engine that listens on loopback alone, are the two the same
 * machine, so only there may such a page pair unlisted.
 *
 * - On a desktop engine, a loopback page may pair, over http or https.
 * - Any other page, and a loopback page on any other engine, may pair only
 *   once the operator has listed its origin, and a non-loopback page only
 *   over https. A hosted web app therefore cannot pair with an engine unless
 *   its operator chose to let it.
 * - No `Origin` (not a browser), the opaque `null`, and the desktop app's own
 *   window (which registers rather than pairs) may not.
 */
export function admitPairingOrigin(
  origin: string | null,
  isListed: (origin: string) => boolean,
  loopbackPairsUnlisted: boolean
): PairingOriginAdmission {
  if (origin === null) {
    return { ok: false, error: "pairing needs a web page: the request carried no Origin" };
  }
  const comparable = comparableOriginOf(origin);
  if (comparable === null) {
    return { ok: false, error: `the page's origin ${JSON.stringify(origin)} cannot pair` };
  }
  const url = new URL(comparable);
  if (APP_HOSTS.has(url.hostname) || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return { ok: false, error: `${comparable} is an app, not a web page; it registers rather than pairs` };
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (loopback && loopbackPairsUnlisted) {
    return { ok: true, origin: comparable };
  }
  if (!loopback && url.protocol !== "https:") {
    return {
      ok: false,
      error: `${comparable} is plain http from another computer, which would send the secret in clear`,
    };
  }
  if (!isListed(comparable)) {
    return {
      ok: false,
      error: `${comparable} may pair only once the engine's operator adds it to WOOFX3_ALLOWED_ORIGINS`,
    };
  }
  return { ok: true, origin: comparable };
}

/**
 * Whether `description` is 1 to 64 characters with no control or format
 * characters. Format characters include the bidi overrides and zero-width
 * marks that could make the approval card show text other than what was sent.
 */
function isDescription(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= PAIRING_DESCRIPTION_MAX_LENGTH &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
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
  /** Denied pairings by id, oldest first, at most `maxDeniedRemembered`. */
  private denials = new Map<string, Denial>();
  private globalStarts: StartWindow;
  private originStarts = new Map<string, StartWindow>();
  /** Keyed by the peer address the server saw. */
  private addressStarts = new Map<string, StartWindow>();
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
  /**
   * Start a pairing for the browser at `requestOrigin`, the `Origin` header
   * of the request that carried it, from `remoteAddress`, the peer address
   * the server saw (behind a reverse proxy, the proxy's; never a forwarded
   * header).
   */
  async start(
    request: StartPairingRequest,
    requestOrigin: string | null,
    remoteAddress: string | null
  ): Promise<StartPairingResponse> {
    const admission = admitPairingOrigin(requestOrigin, this.opts.isListedOrigin, this.opts.loopbackPairsUnlisted);
    if (!admission.ok) {
      this.opts.logger.warn("Refused a pairing from an origin that may not pair", {
        origin: requestOrigin,
        reason: admission.error,
      });
      return { ok: false, code: "origin_refused", error: admission.error };
    }
    const origin = admission.origin;
    if (!isDescription(request?.description) || !isPairingVerifierHash(request?.verifierHash)) {
      return {
        ok: false,
        code: "invalid_request",
        error: `description must be 1 to ${PAIRING_DESCRIPTION_MAX_LENGTH} characters with no control or format characters, and verifierHash a base64url SHA-256`,
      };
    }

    const now = this.now();
    this.pruneExpired(now);
    // A peer the transport could not name shares one window.
    const peer = remoteAddress ?? "unknown";
    const retryAfterMs = Math.max(
      this.globalStarts.waitAt(now),
      windowFor(this.originStarts, origin, this.config.startsPerOriginPerMinute).waitAt(now),
      windowFor(this.addressStarts, peer, this.config.startsPerAddressPerMinute).waitAt(now)
    );
    if (retryAfterMs > 0) {
      this.opts.logger.warn("Refused a pairing over the start rate limit", {
        origin,
        remoteAddress: peer,
        retryAfterMs,
      });
      return { ok: false, code: "rate_limited", error: "too many pairings were started recently", retryAfterMs };
    }
    const fromOrigin = [...this.pairings.values()].filter((pairing) => pairing.origin === origin).length;
    if (this.pairings.size >= this.config.maxPending || fromOrigin >= this.config.maxPendingPerOrigin) {
      this.opts.logger.warn("Refused a pairing: too many are waiting", { origin, pending: this.pairings.size });
      return { ok: false, code: "too_many_pending", error: "too many pairings are waiting for approval" };
    }

    this.globalStarts.record(now);
    windowFor(this.originStarts, origin, this.config.startsPerOriginPerMinute).record(now);
    windowFor(this.addressStarts, peer, this.config.startsPerAddressPerMinute).record(now);
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
    const pairingId = typeof request?.pairingId === "string" ? request.pairingId : null;
    const pairing = pairingId === null ? undefined : this.pairings.get(pairingId);
    if (request?.decision !== "approve" && request?.decision !== "deny") {
      return { ok: false, code: "not_found" };
    }
    if (!pairing) {
      this.pruneExpired(this.now());
      return { ok: false, code: pairingId !== null && this.denials.has(pairingId) ? "already_decided" : "not_found" };
    }
    if (this.expire(pairing, this.now())) {
      return { ok: false, code: "expired" };
    }
    if (pairing.status !== "pending") {
      return { ok: false, code: "already_decided" };
    }
    if (request.decision === "approve") {
      pairing.status = "approved";
    } else {
      this.pairings.delete(pairing.id);
      this.rememberDenial(pairing);
    }
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
   * its start, and the verifier its start committed to. A mismatch answers
   * `not_found`, as a pairing that does not exist does, so neither a pairing
   * id nor a user code seen elsewhere helps. A wrong verifier from the
   * pairing's own origin counts against it; a call from any other origin
   * does not, so knowing a pairing id (from the log or the event) is not
   * enough to cancel someone else's pairing.
   */
  private async ownPairing(
    request: { pairingId: string; verifier: string },
    requestOrigin: string | null,
    now: number
  ): Promise<{ kind: "found"; pairing: Pairing } | { kind: "not_found" | "expired" | "denied" }> {
    const pairingId = typeof request?.pairingId === "string" ? request.pairingId : null;
    const pairing = pairingId === null ? undefined : this.pairings.get(pairingId);
    const denial = pairingId === null ? undefined : this.denials.get(pairingId);
    if (!pairing && !denial) {
      return { kind: "not_found" };
    }
    const presentedHash = isPairingVerifier(request.verifier) ? await pairingVerifierHash(request.verifier) : null;
    const fromOwnOrigin = requestOrigin !== null && comparableOriginOf(requestOrigin) === (pairing ?? denial)?.origin;
    if (denial && pairingId !== null) {
      // A denial answers its own browser once, while it would have been
      // pending; nobody else learns anything from it.
      if (!fromOwnOrigin || presentedHash === null || !secretsMatch(denial.verifierHash, presentedHash)) {
        return { kind: "not_found" };
      }
      this.denials.delete(pairingId);
      return now < denial.expiresAtMs ? { kind: "denied" } : { kind: "expired" };
    }
    // The hash was awaited: the pairing may have been claimed, cancelled,
    // denied or forgotten meanwhile, and a stale copy must not be acted on.
    if (!pairing || this.pairings.get(pairing.id) !== pairing) {
      return { kind: "not_found" };
    }
    if (!fromOwnOrigin) {
      this.opts.logger.warn("Refused a pairing claim from another origin", {
        pairingId: pairing.id,
        origin: requestOrigin,
      });
      return { kind: "not_found" };
    }
    const verified = presentedHash !== null && secretsMatch(pairing.verifierHash, presentedHash);
    if (!verified) {
      pairing.failedClaims += 1;
      this.opts.logger.warn("Refused a pairing claim with a wrong verifier", {
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
      // The detail is for the operator; the browser only needs to retry.
      this.opts.logger.error("Could not create a paired client", {
        pairingId: pairing.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "failed", retryable: true, error: "the engine could not create the client; try again" };
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

  private rememberDenial(pairing: Pairing): void {
    this.denials.set(pairing.id, {
      origin: pairing.origin,
      verifierHash: pairing.verifierHash,
      expiresAtMs: pairing.expiresAtMs,
    });
    // Oldest first: past the bound, the oldest denial's browser sees
    // `not_found` instead of `denied`, and starts again.
    for (const id of this.denials.keys()) {
      if (this.denials.size <= this.config.maxDeniedRemembered) {
        break;
      }
      this.denials.delete(id);
    }
  }

  private pruneExpired(now: number): void {
    for (const pairing of [...this.pairings.values()]) {
      this.expire(pairing, now);
    }
    for (const [id, denial] of this.denials) {
      if (denial.expiresAtMs <= now) {
        this.denials.delete(id);
      }
    }
    for (const windows of [this.originStarts, this.addressStarts]) {
      for (const [key, window] of windows) {
        if (window.emptyAt(now)) {
          windows.delete(key);
        }
      }
    }
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

/**
 * The start window for `key` in `windows`, made on first use. Windows are
 * recorded only for starts that passed every limit, so the global limit
 * bounds how many exist at once.
 */
function windowFor(windows: Map<string, StartWindow>, key: string, limit: number): StartWindow {
  let window = windows.get(key);
  if (!window) {
    window = new StartWindow(limit);
    windows.set(key, window);
  }
  return window;
}

/** Whether an approver sees `pairing`: one being claimed is all but done. */
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
