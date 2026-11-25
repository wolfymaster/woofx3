import { EngineRequestType, type KickTokenGrant, type KickTokenRequestedResponse } from "@woofx3/api/webhooks";
import {
  KICK_TOKEN_SUBJECT,
  type KickTokenReply,
  type KickTokenUnavailableReason,
} from "@woofx3/common/cloudevents/Kick/token";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DbClient } from "./db-client";

/** Must match KICK_TOKEN_SETTING in connectors/src/host/link-readers.ts, which reads it. */
export const KICK_TOKEN_SETTING = "kick_token";

/** A token this close to its expiry is renewed before use. */
const EXPIRY_MARGIN_MS = 60_000;

/** What `KickTokenSource` needs to ask a dashboard; `WebhookClient` provides it. */
export interface KickDashboardRequester {
  request(request: { type: typeof EngineRequestType.KICK_TOKEN_REQUESTED }, targetClientId: string): Promise<unknown>;
}

/** The dashboard's grant as stored, with the engine client id of the dashboard to ask for the next one. */
type StoredKickToken = KickTokenGrant & { dashboardClientId: string };

/** The linked Kick account as the stored row and this source know it, never its token. */
export interface StoredKickLinkAccount {
  userId: string;
  scopes: string[];
  /** Milliseconds since the epoch when the access token expires. */
  expiresAt: number;
  /** When renewing the token was refused, in milliseconds since the epoch; null while it works. */
  authFailedAt: number | null;
}

/** The link at one revision; `account` is null when nothing is linked. */
export interface StoredKickLink {
  revision: number;
  account: StoredKickLinkAccount | null;
}

/** Why no token can be served, with the reason a caller acts on. */
export class KickTokenUnavailable extends Error {
  constructor(
    readonly reason: KickTokenUnavailableReason,
    message: string
  ) {
    super(message);
  }
}

export interface KickTokenSourceOptions {
  db: Pick<DbClient, "getSetting" | "setSetting">;
  /** The connection to ask a dashboard on, or null while there is none. */
  dashboard: () => KickDashboardRequester | null;
  now: () => number;
}

/**
 * The linked Kick account's token. Kick requires the app's client secret for
 * every refresh, so the dashboard that linked the account owns the refresh
 * token and the secret; the engine keeps only the access token and asks that
 * dashboard (`kick.token.requested`) for a new one when it is about to expire
 * or Kick refused it.
 *
 * Every write of `kick_token` goes through here, one at a time
 * (`serialized`). A renewal writes only if the row still holds the token it
 * renewed, so a link stored meanwhile is never overwritten by a renewal of
 * the old one.
 */
export class KickTokenSource {
  private pending: Promise<KickTokenGrant> | null = null;
  /**
   * When renewing the stored link's token was refused; null while it works.
   * Memory is enough: after a restart the next renewal finds out again.
   */
  private authFailedAt: number | null = null;
  /** Raised on every change to the link, and never below the clock, so it keeps rising across a restart. */
  private revision: number;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly opts: KickTokenSourceOptions) {
    this.revision = opts.now();
  }

  /** Store a new link from the dashboard whose engine client id is `dashboardClientId`. */
  async store(grant: KickTokenGrant, dashboardClientId: string, engineUserId?: string): Promise<void> {
    const parsed = asGrant(grant);
    if (parsed === null) {
      throw new Error("A Kick token to store needs its user id, access token, scopes, lifetime and client id");
    }
    if (dashboardClientId === "") {
      throw new Error("A Kick token needs the client id of the dashboard that renews it");
    }
    const stored: StoredKickToken = { ...parsed, dashboardClientId };
    await this.serialized(async () => {
      await this.opts.db.setSetting(KICK_TOKEN_SETTING, JSON.stringify(stored), engineUserId);
      this.authFailedAt = null;
      this.raiseRevision();
    });
  }

  /** Forget the link. An empty value, not a deleted row, so readers see "not linked". */
  async clear(): Promise<void> {
    await this.serialized(async () => {
      await this.opts.db.setSetting(KICK_TOKEN_SETTING, "");
      this.authFailedAt = null;
      this.raiseRevision();
    });
  }

  /** The link and its revision, read in the write queue so the two agree. */
  async link(): Promise<StoredKickLink> {
    return this.serialized(async () => {
      const stored = await this.read();
      if (stored === null) {
        return { revision: this.revision, account: null };
      }
      return {
        revision: this.revision,
        account: {
          userId: stored.userId,
          scopes: stored.scope,
          expiresAt: expiresAt(stored),
          authFailedAt: this.authFailedAt,
        },
      };
    });
  }

  /**
   * The current token, renewed through the dashboard when it is about to
   * expire or `force` is set (Kick refused it). Concurrent callers share one
   * renewal. Throws `KickTokenUnavailable` when there is no token to give.
   */
  async servedToken(force: boolean): Promise<KickTokenGrant> {
    const stored = await this.read();
    if (stored === null) {
      throw new KickTokenUnavailable("not_linked", "Kick is not linked");
    }
    if (!force && expiresAt(stored) - EXPIRY_MARGIN_MS > this.opts.now()) {
      return withoutDashboardClientId(stored);
    }
    if (this.pending === null) {
      this.pending = this.renew(stored).finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async renew(from: StoredKickToken): Promise<KickTokenGrant> {
    const dashboard = this.opts.dashboard();
    if (dashboard === null) {
      throw new KickTokenUnavailable("unavailable", "no dashboard connection to ask for a Kick token");
    }
    const answer = parseKickTokenResponse(
      await dashboard.request({ type: EngineRequestType.KICK_TOKEN_REQUESTED }, from.dashboardClientId)
    );
    if (answer.token === null) {
      await this.markAuthFailed(from);
      throw new KickTokenUnavailable(answer.reason, `the dashboard has no Kick token to give (${answer.reason})`);
    }
    const renewed: StoredKickToken = { ...answer.token, dashboardClientId: from.dashboardClientId };
    const saved = await this.serialized(async () => {
      const stored = await this.read();
      if (stored === null || stored.accessToken !== from.accessToken) {
        return false;
      }
      await this.opts.db.setSetting(KICK_TOKEN_SETTING, JSON.stringify(renewed));
      if (stored.userId !== renewed.userId || this.authFailedAt !== null) {
        this.authFailedAt = null;
        this.raiseRevision();
      }
      return true;
    });
    if (!saved) {
      const relinked = await this.read();
      if (relinked === null) {
        throw new KickTokenUnavailable("not_linked", "Kick was unlinked while its token was being renewed");
      }
      return withoutDashboardClientId(relinked);
    }
    return answer.token;
  }

  /** Record that the dashboard refused to renew `refused`, unless the row has moved on to another link. */
  private async markAuthFailed(refused: StoredKickToken): Promise<void> {
    await this.serialized(async () => {
      const stored = await this.read();
      if (stored === null || stored.accessToken !== refused.accessToken || this.authFailedAt !== null) {
        return;
      }
      this.authFailedAt = this.opts.now();
      this.raiseRevision();
    });
  }

  private raiseRevision(): void {
    this.revision = Math.max(this.revision + 1, this.opts.now());
  }

  /** Run `write` once every write queued before it has settled; a failed write does not stop the next. */
  private serialized<T>(write: () => Promise<T>): Promise<T> {
    const result = this.writes.then(write);
    this.writes = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** The stored token; null when unlinked. Throws on a row that is not a stored token, which relinking replaces. */
  private async read(): Promise<StoredKickToken | null> {
    const raw = await this.opts.db.getSetting(KICK_TOKEN_SETTING);
    if (raw === null || raw.trim() === "") {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    const grant = isRecord(parsed) ? asGrant(parsed) : null;
    if (grant === null || !isRecord(parsed) || typeof parsed.dashboardClientId !== "string") {
      throw new Error("kick_token is not a stored Kick token; link Kick again");
    }
    return { ...grant, dashboardClientId: parsed.dashboardClientId };
  }
}

function expiresAt(token: KickTokenGrant): number {
  return token.obtainmentTimestamp + token.expiresIn * 1000;
}

function withoutDashboardClientId({ dashboardClientId: _, ...grant }: StoredKickToken): KickTokenGrant {
  return grant;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asGrant(value: object): KickTokenGrant | null {
  const { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId } = value as Record<string, unknown>;
  if (
    typeof userId !== "string" ||
    userId === "" ||
    typeof accessToken !== "string" ||
    accessToken === "" ||
    typeof clientId !== "string" ||
    clientId === "" ||
    !Array.isArray(scope) ||
    !scope.every((s) => typeof s === "string") ||
    typeof expiresIn !== "number" ||
    typeof obtainmentTimestamp !== "number"
  ) {
    return null;
  }
  return { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId };
}

/** The dashboard's answer to `kick.token.requested`, refusing anything that is not one. */
export function parseKickTokenResponse(body: unknown): KickTokenRequestedResponse {
  if (!isRecord(body) || !("token" in body)) {
    throw new Error("the dashboard's answer has no token field");
  }
  if (body.token === null) {
    if (body.reason !== "not_linked" && body.reason !== "relink_required") {
      throw new Error("the dashboard refused without a known reason");
    }
    return { token: null, reason: body.reason };
  }
  const grant = isRecord(body.token) ? asGrant(body.token) : null;
  if (grant === null) {
    throw new Error("the dashboard's Kick token is malformed");
  }
  return { token: grant };
}

/**
 * Answer the connectors Kick adapter's requests for the linked account's
 * token on `KICK_TOKEN_SUBJECT`. The request is `{ force?: boolean }`.
 */
export async function serveKickToken(nats: NATSClient, source: KickTokenSource, logger: SharedLogger): Promise<void> {
  await nats.subscribe(KICK_TOKEN_SUBJECT, async (msg: Msg) => {
    msg.respond(new TextEncoder().encode(JSON.stringify(await answerKickTokenRequest(msg.data, source, logger))));
  });
}

/** One `engine.kick.token` reply. An empty or non-JSON request asks for the current token. */
export async function answerKickTokenRequest(
  request: Uint8Array,
  source: Pick<KickTokenSource, "servedToken">,
  logger: SharedLogger
): Promise<KickTokenReply> {
  const force = readForce(request);
  try {
    return { token: await source.servedToken(force) };
  } catch (err) {
    const reason: KickTokenUnavailableReason = err instanceof KickTokenUnavailable ? err.reason : "unavailable";
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("kick token request failed", { error: message, reason, force });
    return { token: null, reason, error: message };
  }
}

function readForce(request: Uint8Array): boolean {
  const text = new TextDecoder().decode(request);
  if (text.trim() === "") {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && parsed.force === true;
  } catch {
    return false;
  }
}
