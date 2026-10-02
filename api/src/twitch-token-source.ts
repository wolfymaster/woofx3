import {
  type EngineRequest,
  EngineRequestType,
  type TwitchTokenGrant,
  type TwitchTokenRequestedResponse,
} from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DbClient } from "./db-client";

export const TWITCH_TOKEN_SETTING = "twitch_token";

/**
 * NATS subject the engine's other services ask on for the linked account's
 * Twitch token when it came from a dashboard. The request is
 * `{ force?: boolean }`; the reply is `{ token }` or `{ error }`.
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
 * The linked Twitch account's token, wherever it is renewed.
 *
 * A token sent by a dashboard carries the dashboard's Twitch app `clientId`
 * and no refresh token: the dashboard owns both the refresh token and the app
 * secret, and an engine, which may be self-hosted, never gets them. When such
 * a token is about to expire this asks the dashboard that sent it for a new
 * one. Any other token is one the twitch service refreshes with the engine's
 * own Twitch app credentials; this only reads it.
 */
export class TwitchTokenSource implements TwitchCredentials {
  private pending: Promise<TwitchTokenGrant> | null = null;

  constructor(
    private readonly db: Pick<DbClient, "getSetting" | "setSetting">,
    private readonly dashboard: () => DashboardRequester | null,
    private readonly ownClientId: () => string | undefined = () => process.env.WOOFX3_TWITCH_CLIENT_ID,
    private readonly now: () => number = () => Date.now()
  ) {}

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
    if (asDashboardToken(stored)) {
      try {
        const token = await this.dashboardToken(false);
        return { clientId: token.clientId, accessToken: token.accessToken, broadcasterId: token.userId };
      } catch (err) {
        return `could not get a Twitch token from the dashboard: ${errorMessage(err)}`;
      }
    }
    const clientId = this.ownClientId();
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
   * The token a dashboard sent, renewed through that dashboard when it is
   * about to expire or `force` is set (Twitch refused it). Concurrent callers
   * share one renewal.
   */
  async dashboardToken(force: boolean): Promise<TwitchTokenGrant> {
    const stored = await this.read();
    const token = stored ? asDashboardToken(stored) : null;
    if (!token) {
      throw new Error("twitch_token did not come from a dashboard");
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

function asDashboardToken(stored: Record<string, unknown>): StoredDashboardToken | null {
  if (typeof stored.dashboardClientId !== "string" || !stored.dashboardClientId) {
    return null;
  }
  const grant = asGrant(stored);
  return grant ? { ...grant, dashboardClientId: stored.dashboardClientId } : null;
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

function withoutDashboardClientId({ dashboardClientId: _, ...grant }: StoredDashboardToken): TwitchTokenGrant {
  return grant;
}

/**
 * Answer the engine's other services' requests for the dashboard's token on
 * `TWITCH_TOKEN_SUBJECT`. They never hold the dashboard's address or
 * credentials; this service is the one that talks to the dashboard.
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
      reply = { token: await source.dashboardToken(force) };
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
