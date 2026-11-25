import type { KickTokenGrant } from "@woofx3/api/webhooks";
import {
  KICK_TOKEN_SUBJECT,
  type KickTokenUnavailableReason,
  parseKickTokenReply,
} from "@woofx3/common/cloudevents/Kick/token";
import { requestFailureKind } from "@woofx3/nats";
import { type Clock, errorMessage } from "../../../host/deps";

/** How the token is requested: the adapter's scoped bus, which allows `engine.kick.token`. */
export type KickTokenRequest = (
  subject: string,
  data: Uint8Array,
  opts: { timeout: number }
) => Promise<{ data: Uint8Array }>;

export interface KickTokenClientDeps {
  request: KickTokenRequest;
  clock: Clock;
  /** How long one token request may wait on the api. */
  timeoutMs: number;
  /** A token this close to its expiry is asked for again rather than used. */
  expiryMarginMs: number;
}

/**
 * Why no token: one of the api's reasons, or `no_answer` when the api did
 * not answer (it is down or slow; asking again later may work).
 */
export type KickTokenFailure = { reason: KickTokenUnavailableReason | "no_answer"; message: string };

export type KickTokenResult = { ok: true; token: KickTokenGrant } | { ok: false; failure: KickTokenFailure };

/**
 * The linked Kick account's access token, from the api over
 * `engine.kick.token`. The api owns the token and asks the dashboard to renew
 * it; this keeps the last one until it is about to expire, so a REST call
 * does not wait on the bus for every request.
 */
export class KickTokenClient {
  private cached: KickTokenGrant | undefined;

  constructor(private readonly deps: KickTokenClientDeps) {}

  /** The current token. `force` asks the api for a renewal because Kick refused the cached one. */
  /** `timeoutMs` cuts the wait below the configured one, for a caller with a deadline. */
  async get(opts: { force?: boolean; timeoutMs?: number } = {}): Promise<KickTokenResult> {
    const force = opts.force === true;
    const cached = this.cached;
    if (!force && cached !== undefined && this.fresh(cached)) {
      return { ok: true, token: cached };
    }
    this.cached = undefined;
    let raw: { data: Uint8Array };
    try {
      raw = await this.deps.request(KICK_TOKEN_SUBJECT, new TextEncoder().encode(JSON.stringify({ force })), {
        timeout: Math.min(this.deps.timeoutMs, opts.timeoutMs ?? this.deps.timeoutMs),
      });
    } catch (err) {
      const kind = requestFailureKind(err);
      return {
        ok: false,
        failure: { reason: "no_answer", message: `the api did not answer (${kind}): ${errorMessage(err)}` },
      };
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw.data));
    } catch (err) {
      return {
        ok: false,
        failure: { reason: "unavailable", message: `the api's token reply is not JSON: ${errorMessage(err)}` },
      };
    }
    const reply = parseKickTokenReply(body);
    if (!reply.ok) {
      return { ok: false, failure: { reason: "unavailable", message: `the api's token reply ${reply.error}` } };
    }
    if (reply.value.token === null) {
      return { ok: false, failure: { reason: reply.value.reason, message: reply.value.error } };
    }
    this.cached = reply.value.token;
    return { ok: true, token: reply.value.token };
  }

  /** Drop the cached token, for a relink: the next `get` asks the api. */
  forget(): void {
    this.cached = undefined;
  }

  private fresh(token: KickTokenGrant): boolean {
    return token.obtainmentTimestamp + token.expiresIn * 1000 - this.deps.expiryMarginMs > this.deps.clock.now();
  }
}
