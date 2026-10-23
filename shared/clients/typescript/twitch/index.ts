import { ApiClient, type HelixUser } from "@twurple/api";
import type { AccessTokenWithUserId, AuthProvider } from "@twurple/auth";
import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { DashboardAuthProvider, type DashboardToken, type RequestDashboardToken } from "./dashboard-auth-provider";
import { publicClientIdOf, selectStrategy } from "./token-strategy";

export type { ApiClient } from "@twurple/api";
export type { ChatClient, ChatMessage } from "@twurple/chat";
export type { EventSubWsListener } from "@twurple/eventsub-ws";
export type { DashboardToken, RequestDashboardToken } from "./dashboard-auth-provider";
export { requestTokenOverNats, TWITCH_TOKEN_SUBJECT } from "./dashboard-auth-provider";
export { publicClientIdOf, selectStrategy, type TokenStrategy } from "./token-strategy";

export type GetSettingFn = (key: string) => Promise<string | undefined>;
export type SetSettingFn = (key: string, value: string) => Promise<void>;

export type TwitchClientArgs = {
  /**
   * The broadcaster's channel (login name). Optional: when absent the
   * broadcaster is whoever linked Twitch, read from the stored token, so an
   * engine needs no channel configured before its streamer links Twitch.
   */
  channel?: string;
  getSetting: GetSettingFn;
  /**
   * Optional persistence hook for refreshed access tokens. When set,
   * Twurple's `RefreshingAuthProvider.onRefresh` callback writes the
   * refreshed `AccessTokenWithUserId` back through this function so the
   * persisted `twitch_token` setting stays in sync with what the
   * provider holds in memory. Without it, restarts re-load the
   * pre-refresh token and Twurple has to refresh again from scratch.
   */
  setSetting?: SetSettingFn;
  /**
   * How to get a current token from the api service when this client must
   * not refresh the stored one itself: a dashboard's token (it carries the
   * dashboard's `clientId`; the dashboard owns the refresh token and the app
   * secret) or one from the engine's public Twitch app (its refresh tokens
   * are single-use, so the api service alone refreshes it).
   */
  requestToken?: RequestDashboardToken;
};

export type TwitchAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/**
 * `name` of the error `init` rejects with when no Twitch account is linked
 * (the `twitch_token` setting is missing or blank). Callers check the name
 * rather than the class so it survives a mocked or duplicated module.
 */
export const TWITCH_NOT_LINKED = "TwitchNotLinked";

export class TwitchNotLinkedError extends Error {
  constructor() {
    super("Missing broadcaster token in db proxy setting: twitch_token");
    this.name = TWITCH_NOT_LINKED;
  }
}

export default class TwitchClient {
  private authProvider: AuthProvider | null;
  /** Twitch user id of whoever linked Twitch, from the stored token. */
  private linkedUserId: string | null = null;
  /**
   * The refresh token of the token this client last loaded or persisted.
   * A stored token with a different one was written by someone else (a
   * relink in the UI), and a refresh of the old token must not overwrite it.
   */
  private knownRefreshToken: string | null = null;
  private apiClient: ApiClient | null;
  private eventListener: EventSubWsListener | null;

  constructor(private args: TwitchClientArgs) {
    this.authProvider = null;
    this.apiClient = null;
    this.eventListener = null;
  }

  /**
   * Authenticate with the stored token. A token from a dashboard or from the
   * engine's public Twitch app needs `requestToken`; any other token is
   * refreshed here, with `credentials`.
   *
   * Rejects with `signal`'s reason once it aborts, between steps: reading the
   * stored token and registering it with Twitch each run to completion, but
   * nothing after an abort is kept, so the client stays uninitialized.
   */
  async init(credentials?: TwitchAuthCredentials, signal?: AbortSignal): Promise<AuthProvider> {
    signal?.throwIfAborted();
    const authProvider = await this.authenticate(credentials, signal);
    signal?.throwIfAborted();
    this.authProvider = authProvider;
    return authProvider;
  }

  ApiClient(): ApiClient {
    if (!this.authProvider) {
      throw new Error("Must initialize TwitchClient before use");
    }

    if (this.apiClient) {
      return this.apiClient;
    }

    this.apiClient = new ApiClient({
      authProvider: this.authProvider,
    });
    return this.apiClient;
  }

  /**
   * A chat client joined to `channel`, or to the configured channel when none
   * is given. Callers without a configured channel pass the broadcaster's
   * login (see `broadcaster`).
   */
  ChatClient(channel: string | undefined = this.args.channel): ChatClient {
    if (!this.authProvider) {
      throw new Error("Must initialize TwitchClient before use");
    }
    if (!channel) {
      throw new Error("ChatClient needs a channel: none was configured or given");
    }

    return new ChatClient({
      authProvider: this.authProvider,
      channels: [channel],
    });
  }

  EventBusListener(): EventSubWsListener {
    if (!this.authProvider) {
      throw new Error("Must initialize TwitchClient before use");
    }

    if (this.eventListener) {
      return this.eventListener;
    }

    const apiClient = this.ApiClient();
    this.eventListener = new EventSubWsListener({ apiClient });
    return this.eventListener;
  }

  /**
   * Release what this client owns. Only the EventSub listener is held here -
   * ChatClient() hands out a fresh instance per call, so its lifetime belongs
   * to the caller. Safe to call when nothing was started.
   */
  async close(): Promise<void> {
    if (this.eventListener) {
      this.eventListener.stop();
      this.eventListener = null;
    }
  }

  /**
   * The broadcaster: the configured channel, or, when none is configured,
   * the Twitch user who linked the stored token.
   */
  async broadcaster(): Promise<HelixUser> {
    if (this.args.channel) {
      const user = await this.ApiClient().users.getUserByName({ name: this.args.channel });
      if (!user) {
        throw new Error(`Failed to retrieve Twitch Helix user: ${this.args.channel}`);
      }
      return user;
    }
    if (!this.linkedUserId) {
      throw new Error("Must initialize TwitchClient before use");
    }
    const user = await this.ApiClient().users.getUserById(this.linkedUserId);
    if (!user) {
      throw new Error(`Failed to retrieve Twitch Helix user for the linked account: ${this.linkedUserId}`);
    }
    return user;
  }

  /**
   * Re-read the stored token and hand it to the auth provider, replacing the
   * one it holds. Called when the streamer relinks Twitch (to grant a new
   * scope, say) while this client is running: without it the provider keeps
   * refreshing the old token and never sees the new scopes.
   *
   * Returns the linked user id and what a token swap could not cover, which
   * the caller handles by reconnecting from scratch:
   * - `userChanged`: a different account means a different broadcaster.
   * - `providerChanged`: the new token is renewed differently from the one
   *   loaded (asked of the api service, or refreshed here with the
   *   confidential app), so it needs a different auth provider. Nothing is
   *   applied in that case.
   */
  async reloadToken(): Promise<{ userId: string; userChanged: boolean; providerChanged: boolean }> {
    if (!this.authProvider) {
      throw new Error("Must initialize TwitchClient before use");
    }
    const token = await this.getBroadcasterToken();
    const previous = this.linkedUserId;
    const servedToken = asServedToken(token);
    let userId: string;
    if (this.authProvider instanceof DashboardAuthProvider) {
      if (!servedToken) {
        return {
          userId: token.userId,
          userChanged: previous !== null && previous !== token.userId,
          providerChanged: true,
        };
      }
      this.authProvider.replace(servedToken);
      userId = servedToken.userId;
    } else if (this.authProvider instanceof RefreshingAuthProvider) {
      if (servedToken) {
        return {
          userId: servedToken.userId,
          userChanged: previous !== null && previous !== servedToken.userId,
          providerChanged: true,
        };
      }
      userId = await this.authProvider.addUserForToken(token, ["chat"]);
      this.knownRefreshToken = token.refreshToken ?? null;
    } else {
      throw new Error("Must initialize TwitchClient before use");
    }
    this.linkedUserId = userId;
    return { userId, userChanged: previous !== null && previous !== userId, providerChanged: false };
  }

  /**
   * Persist a refreshed token unless the stored one has moved on since this
   * client loaded it. A relink writes a new token (new refresh token, later
   * obtainment time) to the same setting; the provider may still refresh
   * the old token before it hears about the relink, and writing that back
   * would silently undo the relink and its scopes.
   */
  private async persistRefreshedToken(
    userId: string,
    token: AccessTokenWithUserId | Omit<AccessTokenWithUserId, "userId">
  ): Promise<void> {
    if (!this.args.setSetting) {
      return;
    }
    try {
      const raw = await this.args.getSetting("twitch_token");
      if (raw && raw.trim() !== "") {
        const stored = JSON.parse(raw) as Partial<AccessTokenWithUserId>;
        const replacedElsewhere =
          (stored.refreshToken ?? null) !== this.knownRefreshToken ||
          (stored.obtainmentTimestamp ?? 0) > token.obtainmentTimestamp;
        if (replacedElsewhere) {
          console.warn(
            "twitch_token changed since it was loaded (relinked?); not overwriting it with a refresh of the old token"
          );
          return;
        }
      }
      await this.args.setSetting("twitch_token", JSON.stringify({ ...token, userId }));
      this.knownRefreshToken = token.refreshToken ?? null;
    } catch (err) {
      console.error("failed to persist refreshed twitch_token: ", err);
    }
  }

  private async getBroadcasterToken(): Promise<AccessTokenWithUserId> {
    const token = await this.args.getSetting("twitch_token");
    if (!token || token.trim() === "") {
      throw new TwitchNotLinkedError();
    }
    return JSON.parse(token) satisfies AccessTokenWithUserId;
  }

  private async authenticate(
    credentials: TwitchAuthCredentials | undefined,
    signal: AbortSignal | undefined
  ): Promise<AuthProvider> {
    const stored = await this.getBroadcasterToken();
    signal?.throwIfAborted();
    switch (selectStrategy(stored)) {
      case "dashboard":
        return this.authenticateWithDashboard(stored);
      case "engineRefresh":
        if (publicClientIdOf(stored) !== null) {
          return this.authenticateWithDashboard(stored);
        }
        return this.authenticateWithEngineRefresh(stored, credentials);
    }
  }

  /** A token the api service renews: this client asks it for each new one rather than refreshing. */
  private authenticateWithDashboard(stored: AccessTokenWithUserId): AuthProvider {
    const dashboardToken = asServedToken(stored);
    if (!dashboardToken) {
      throw new Error("invariant: a dashboard's or public app's token converts to a DashboardToken");
    }
    if (!this.args.requestToken) {
      throw new Error(
        "twitch_token is renewed by the api service, but TwitchClient was given no requestToken to ask it"
      );
    }
    this.linkedUserId = dashboardToken.userId;
    return new DashboardAuthProvider(dashboardToken, this.args.requestToken);
  }

  private async authenticateWithEngineRefresh(
    stored: AccessTokenWithUserId,
    credentials: TwitchAuthCredentials | undefined
  ): Promise<AuthProvider> {
    if (!credentials?.clientId || !credentials.clientSecret) {
      throw new Error(
        "twitch_token did not come from a dashboard, and no Twitch app credentials are configured to refresh it"
      );
    }
    const authProvider = new RefreshingAuthProvider(credentials);

    authProvider.onRefresh(async (userId, token) => {
      console.log("refreshing token for: ", userId);
      // Without persisting, an engine restart loads the pre-refresh row and
      // has to refresh again, which fails once Twitch invalidates the old
      // refresh token.
      await this.persistRefreshedToken(userId, token);
    });

    authProvider.onRefreshFailure((userId, error) => {
      console.log("failed to refresh token for: ", userId);
      console.error(error);
    });

    this.linkedUserId = await authProvider.addUserForToken(stored, ["chat"]);
    this.knownRefreshToken = stored.refreshToken ?? null;

    return authProvider;
  }
}

/**
 * The stored token as one the api service serves, with the client id of the
 * Twitch app that issued it, or null when this client refreshes it itself.
 * The refresh token is dropped: the api service is the one that spends it.
 */
function asServedToken(token: AccessTokenWithUserId & { clientId?: unknown }): DashboardToken | null {
  if (selectStrategy(token) === "dashboard" && typeof token.clientId === "string") {
    return { ...token, refreshToken: null, clientId: token.clientId };
  }
  const publicClientId = publicClientIdOf(token);
  if (publicClientId !== null) {
    return { ...token, refreshToken: null, clientId: publicClientId };
  }
  return null;
}
