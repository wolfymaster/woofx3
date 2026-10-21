import {
  type EngineRequest,
  EngineRequestType,
  type TwitchTokenGrant,
  type TwitchTokenRequestedResponse,
} from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type PublicClientToken, type TwitchOAuthClient, TwitchOAuthError } from "@woofx3/twitch/oauth";
import { publicClientIdOf, selectStrategy } from "@woofx3/twitch/token-strategy";
import type { DbClient } from "./db-client";

export const TWITCH_TOKEN_SETTING = "twitch_token";

/**
 * NATS subject the engine's other services ask on for the linked account's
 * Twitch token when this service renews it: a dashboard's, or the engine's
 * public Twitch app's. The request is `{ force?: boolean }`; the reply is
 * `{ token }` or `{ error }`.
 */
export const TWITCH_TOKEN_SUBJECT = "engine.twitch.token";

/** A token this close to its expiry is renewed before use. */
const EXPIRY_MARGIN_MS = 60_000;

export interface HelixCredentials {
  clientId: string;
  accessToken: string;
  broadcasterId: string;
}

export interface TwitchCredentials {
  /** Credentials for a Helix call, or why there are none. Never throws. */
  helix(): Promise<HelixCredentials | string>;
}

/** What `TwitchTokenSource` needs to ask a dashboard; `WebhookClient` provides it. */
export interface DashboardRequester {
  request(request: EngineRequest, targetClientId: string): Promise<unknown>;
}

/**
 * A token from a dashboard, as stored: the dashboard's grant plus the engine
 * client id of the dashboard that sent it, which is the one to ask for the
 * next.
 */
type StoredDashboardToken = TwitchTokenGrant & { dashboardClientId: string };

/**
 * A token from the engine's public Twitch app (a device login), as stored:
 * the whole token, its single-use refresh token included, in one setting
 * value, so the access token and the refresh token that goes with it are
 * always written together.
 */
export type StoredPublicToken = PublicClientToken & { userId: string; publicClientId: string };

/** What `TwitchTokenSource` needs to refresh a public app's token; `TwitchOAuthClient` provides it. */
export type PublicClientRefresher = Pick<TwitchOAuthClient, "refresh">;

export interface TwitchTokenSourceOptions {
  db: Pick<DbClient, "getSetting" | "setSetting">;
  /** The connection to ask a dashboard on, or null while there is none. */
  dashboard: () => DashboardRequester | null;
  /** The engine's confidential Twitch app (`WOOFX3_TWITCH_CLIENT_ID`), or null when it has none. */
  ownClientId: string | null;
  publicClient: PublicClientRefresher;
  now?: () => number;
}

/**
 * The linked Twitch account's token, wherever it is renewed.
 *
 * A token sent by a dashboard carries the dashboard's Twitch app `clientId`
 * and no refresh token: the dashboard owns both the refresh token and the app
 * secret, and an engine, which may be self-hosted, never gets them. When such
 * a token is about to expire this asks the dashboard that sent it for a new
 * one.
 *
 * A token from the engine's public Twitch app (a device login) is refreshed
 * here, and only here: Twitch makes its refresh tokens single-use, so a second
 * process refreshing it would spend a token this one had already spent. The
 * engine's other services ask for it on `TWITCH_TOKEN_SUBJECT`, as for a
 * dashboard's. Any other token is one the twitch service refreshes with the
 * engine's own confidential Twitch app; this only reads it.
 */
export class TwitchTokenSource implements TwitchCredentials {
  private pending: Promise<TwitchTokenGrant> | null = null;
  private publicPending: Promise<TwitchTokenGrant> | null = null;
  /**
   * A refreshed public token whose write failed, with the refresh token it
   * replaced. The stored row still holds that spent refresh token, so until
   * the write lands this copy is the only usable one.
   */
  private unsaved: { spentRefreshToken: string; token: StoredPublicToken } | null = null;
  /** A refresh token Twitch refused. It never works again, so it is not sent again. */
  private refusedRefreshToken: string | null = null;

  private readonly db: TwitchTokenSourceOptions["db"];
  private readonly dashboard: TwitchTokenSourceOptions["dashboard"];
  private readonly ownClientId: string | null;
  private readonly publicClient: PublicClientRefresher;
  private readonly now: () => number;

  constructor(opts: TwitchTokenSourceOptions) {
    this.db = opts.db;
    this.dashboard = opts.dashboard;
    this.ownClientId = opts.ownClientId;
    this.publicClient = opts.publicClient;
    this.now = opts.now ?? (() => Date.now());
  }

  async helix(): Promise<HelixCredentials | string> {
    let stored: Record<string, unknown> | null;
    try {
      stored = await this.read();
    } catch (err) {
      return `failed to read twitch_token: ${errorMessage(err)}`;
    }
    if (!stored) {
      return "no twitch_token setting";
    }
    switch (selectStrategy(stored)) {
      case "dashboard":
        return this.dashboardHelix();
      case "engineRefresh":
        if (publicClientIdOf(stored) !== null) {
          return this.publicHelix();
        }
        return this.engineRefreshHelix(stored);
    }
  }

  private async publicHelix(): Promise<HelixCredentials | string> {
    try {
      const token = await this.publicToken(false);
      return { clientId: token.clientId, accessToken: token.accessToken, broadcasterId: token.userId };
    } catch (err) {
      return `could not get a Twitch token: ${errorMessage(err)}`;
    }
  }

  /**
   * The current token for a service that does not renew it itself: a
   * dashboard's (`dashboardToken`) or the public app's (`publicToken`).
   */
  async servedToken(force: boolean): Promise<TwitchTokenGrant> {
    const stored = await this.read();
    if (stored && publicClientIdOf(stored) !== null) {
      return this.publicToken(force);
    }
    return this.dashboardToken(force);
  }

  /**
   * The public app's token, refreshed when it is about to expire or `force`
   * is set (Twitch refused it). Concurrent callers share one refresh, since a
   * second would spend the refresh token the first already spent.
   */
  async publicToken(force: boolean): Promise<TwitchTokenGrant> {
    const stored = await this.read();
    const token = stored ? asPublicToken(stored) : "there is no twitch_token setting";
    if (token === null) {
      throw new Error("twitch_token did not come from the engine's public Twitch app");
    }
    if (typeof token === "string") {
      throw new Error(token);
    }
    let current = token;
    if (this.unsaved && this.unsaved.spentRefreshToken === token.refreshToken) {
      await this.savePublicToken(this.unsaved.spentRefreshToken, this.unsaved.token);
      current = this.unsaved.token;
      this.unsaved = null;
    }
    if (!force && current.obtainmentTimestamp + current.expiresIn * 1000 - EXPIRY_MARGIN_MS > this.now()) {
      return publicGrant(current);
    }
    if (!this.publicPending) {
      this.publicPending = this.refreshPublic(current).finally(() => {
        this.publicPending = null;
      });
    }
    return this.publicPending;
  }

  private async refreshPublic(current: StoredPublicToken): Promise<TwitchTokenGrant> {
    if (current.refreshToken === this.refusedRefreshToken) {
      throw new Error("Twitch no longer accepts this link's refresh token; link Twitch again");
    }
    let refreshed: PublicClientToken;
    try {
      refreshed = await this.publicClient.refresh(current.publicClientId, current.refreshToken);
    } catch (err) {
      if (err instanceof TwitchOAuthError && err.refused) {
        this.refusedRefreshToken = current.refreshToken;
        throw new Error(`Twitch no longer accepts this link's refresh token (${err.message}); link Twitch again`);
      }
      throw new Error(`could not refresh the Twitch token: ${errorMessage(err)}`);
    }
    const next: StoredPublicToken = { ...refreshed, userId: current.userId, publicClientId: current.publicClientId };
    try {
      await this.savePublicToken(current.refreshToken, next);
    } catch (err) {
      // The old refresh token is spent, so losing `next` would lose the link.
      // Keep it, and write it again before anything else uses the token.
      this.unsaved = { spentRefreshToken: current.refreshToken, token: next };
      throw new Error(`refreshed the Twitch token but could not store it: ${errorMessage(err)}`);
    }
    return publicGrant(next);
  }

  /**
   * Write a refreshed public token unless the stored one has moved on since
   * it was read: a device login or `setTwitchToken` wrote a new link, and a
   * refresh of the old one must not overwrite it.
   */
  private async savePublicToken(spentRefreshToken: string, next: StoredPublicToken): Promise<void> {
    const stored = await this.read();
    const storedRefreshToken = stored && typeof stored.refreshToken === "string" ? stored.refreshToken : null;
    if (storedRefreshToken !== spentRefreshToken) {
      return;
    }
    await this.db.setSetting(TWITCH_TOKEN_SETTING, JSON.stringify(next));
  }

  private async dashboardHelix(): Promise<HelixCredentials | string> {
    try {
      const token = await this.dashboardToken(false);
      return { clientId: token.clientId, accessToken: token.accessToken, broadcasterId: token.userId };
    } catch (err) {
      return `could not get a Twitch token from the dashboard: ${errorMessage(err)}`;
    }
  }

  /** The engine's own token, which the twitch service refreshes; this only reads it. */
  private engineRefreshHelix(stored: Record<string, unknown>): HelixCredentials | string {
    const clientId = this.ownClientId;
    if (!clientId) {
      return "WOOFX3_TWITCH_CLIENT_ID is not set";
    }
    if (
      typeof stored.accessToken !== "string" ||
      typeof stored.userId !== "string" ||
      !stored.accessToken ||
      !stored.userId
    ) {
      return "twitch_token has no accessToken or userId";
    }
    return { clientId, accessToken: stored.accessToken, broadcasterId: stored.userId };
  }

  /**
   * The engine client id of the dashboard the linked Twitch account came
   * from, or null when there is none to ask: the token is the engine's own,
   * is incomplete, or there is no token. That
   * dashboard holds the Twitch link, so it is the one to ask for anything
   * that acts as the channel, such as its shoutout queue.
   */
  async linkedDashboardClientId(): Promise<string | null> {
    const stored = await this.read();
    const token = stored ? asDashboardToken(stored) : null;
    return typeof token === "string" ? null : (token?.dashboardClientId ?? null);
  }

  /**
   * The token a dashboard sent, renewed through that dashboard when it is
   * about to expire or `force` is set (Twitch refused it). Concurrent callers
   * share one renewal.
   */
  async dashboardToken(force: boolean): Promise<TwitchTokenGrant> {
    const stored = await this.read();
    const token = stored ? asDashboardToken(stored) : "there is no twitch_token setting";
    if (token === null) {
      throw new Error("twitch_token did not come from a dashboard");
    }
    if (typeof token === "string") {
      throw new Error(token);
    }
    if (!force && token.obtainmentTimestamp + token.expiresIn * 1000 - EXPIRY_MARGIN_MS > this.now()) {
      return withoutDashboardClientId(token);
    }
    if (!this.pending) {
      this.pending = this.renew(token.dashboardClientId).finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async renew(dashboardClientId: string): Promise<TwitchTokenGrant> {
    const dashboard = this.dashboard();
    if (!dashboard) {
      throw new Error("no dashboard connection to ask for a Twitch token");
    }
    const answer = parseTokenResponse(
      await dashboard.request({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, dashboardClientId)
    );
    if (answer.token === null) {
      throw new Error(`the dashboard has no Twitch token to give (${answer.reason})`);
    }
    const stored: StoredDashboardToken = { ...answer.token, dashboardClientId };
    await this.db.setSetting(TWITCH_TOKEN_SETTING, JSON.stringify(stored));
    return answer.token;
  }

  private async read(): Promise<Record<string, unknown> | null> {
    const raw = await this.db.getSetting(TWITCH_TOKEN_SETTING);
    if (!raw || raw.trim() === "") {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  }
}

/**
 * The stored token as a dashboard's; null when its strategy is not
 * `dashboard`; or, for a dashboard's token that lacks the dashboard client id
 * or a complete grant needed to ask that dashboard for the next one, why it
 * cannot be used. Such a token is never treated as the engine's own: its
 * `clientId` names the dashboard's Twitch app, not the engine's.
 */
function asDashboardToken(stored: Record<string, unknown>): StoredDashboardToken | string | null {
  if (selectStrategy(stored) !== "dashboard") {
    return null;
  }
  if (typeof stored.dashboardClientId !== "string" || !stored.dashboardClientId) {
    return "twitch_token came from a dashboard but does not say which one; relink Twitch from the dashboard";
  }
  const grant = asGrant(stored);
  if (!grant) {
    return "twitch_token came from a dashboard but its grant is incomplete; relink Twitch from the dashboard";
  }
  return { ...grant, dashboardClientId: stored.dashboardClientId };
}

function asGrant(value: Record<string, unknown>): TwitchTokenGrant | null {
  const { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId } = value;
  if (
    typeof userId !== "string" ||
    !userId ||
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof clientId !== "string" ||
    !clientId ||
    !Array.isArray(scope) ||
    !scope.every((s) => typeof s === "string") ||
    typeof expiresIn !== "number" ||
    typeof obtainmentTimestamp !== "number"
  ) {
    return null;
  }
  return { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId };
}

/**
 * The stored token as the public app's; null when it is not one; or, for one
 * whose fields are incomplete, why it cannot be used.
 */
function asPublicToken(stored: Record<string, unknown>): StoredPublicToken | string | null {
  const publicClientId = publicClientIdOf(stored);
  if (publicClientId === null) {
    return null;
  }
  const { userId, accessToken, refreshToken, scope, expiresIn, obtainmentTimestamp } = stored;
  if (
    typeof userId !== "string" ||
    !userId ||
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof refreshToken !== "string" ||
    !refreshToken ||
    !Array.isArray(scope) ||
    !scope.every((s) => typeof s === "string") ||
    typeof expiresIn !== "number" ||
    typeof obtainmentTimestamp !== "number"
  ) {
    return "twitch_token came from the engine's public Twitch app but is incomplete; link Twitch again";
  }
  return { userId, accessToken, refreshToken, scope, expiresIn, obtainmentTimestamp, publicClientId };
}

/** The grant served for a public token: the issuing app's client id, and never the refresh token. */
function publicGrant(token: StoredPublicToken): TwitchTokenGrant {
  return {
    userId: token.userId,
    accessToken: token.accessToken,
    scope: token.scope,
    expiresIn: token.expiresIn,
    obtainmentTimestamp: token.obtainmentTimestamp,
    clientId: token.publicClientId,
  };
}

function withoutDashboardClientId({ dashboardClientId: _, ...grant }: StoredDashboardToken): TwitchTokenGrant {
  return grant;
}

/**
 * Answer the engine's other services' requests for the linked account's token
 * on `TWITCH_TOKEN_SUBJECT`, when it is a dashboard's or the public app's.
 * They never hold the dashboard's address or credentials, or the public app's
 * single-use refresh token; this service is the one that renews either.
 */
export async function serveTwitchToken(
  nats: NATSClient,
  source: TwitchTokenSource,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe(TWITCH_TOKEN_SUBJECT, async (msg: Msg) => {
    let force = false;
    try {
      force = (msg.json() as { force?: unknown } | null)?.force === true;
    } catch {
      // An empty or non-JSON request asks for the current token.
    }
    let reply: { token: TwitchTokenGrant } | { error: string };
    try {
      reply = { token: await source.servedToken(force) };
    } catch (err) {
      logger.warn("twitch token request failed", { error: errorMessage(err), force });
      reply = { error: errorMessage(err) };
    }
    msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
  });
}

/** The dashboard's answer, refusing anything that is not one. */
export function parseTokenResponse(body: unknown): TwitchTokenRequestedResponse {
  if (typeof body !== "object" || body === null || !("token" in body)) {
    throw new Error("the dashboard's answer has no token field");
  }
  const { token, reason } = body as { token: unknown; reason?: unknown };
  if (token === null) {
    if (reason !== "not_linked" && reason !== "relink_required") {
      throw new Error("the dashboard refused without a known reason");
    }
    return { token: null, reason };
  }
  const grant = typeof token === "object" && token !== null ? asGrant(token as Record<string, unknown>) : null;
  if (!grant) {
    throw new Error("the dashboard's token is malformed");
  }
  return { token: grant };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
