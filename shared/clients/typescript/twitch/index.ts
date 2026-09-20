import { ApiClient, type HelixUser } from "@twurple/api";
import type { AccessTokenWithUserId } from "@twurple/auth";
import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import { EventSubWsListener } from "@twurple/eventsub-ws";

export type { ApiClient } from "@twurple/api";
export type { ChatClient, ChatMessage } from "@twurple/chat";
export type { EventSubWsListener } from "@twurple/eventsub-ws";

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
  private authProvider: RefreshingAuthProvider | null;
  /** Twitch user id of whoever linked Twitch, from the stored token. */
  private linkedUserId: string | null = null;
  private apiClient: ApiClient | null;
  private eventListener: EventSubWsListener | null;

  constructor(private args: TwitchClientArgs) {
    this.authProvider = null;
    this.apiClient = null;
    this.eventListener = null;
  }

  async init(credentials: TwitchAuthCredentials): Promise<RefreshingAuthProvider> {
    this.authProvider = await this.authenticate(credentials);
    return this.authProvider;
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

  private async getBroadcasterToken(): Promise<AccessTokenWithUserId> {
    const token = await this.args.getSetting("twitch_token");
    if (!token || token.trim() === "") {
      throw new TwitchNotLinkedError();
    }
    return JSON.parse(token) satisfies AccessTokenWithUserId;
  }

  private async authenticate(credentials: TwitchAuthCredentials): Promise<RefreshingAuthProvider> {
    const authProvider = new RefreshingAuthProvider(credentials);

    authProvider.onRefresh(async (userId, token) => {
      console.log("refreshing token for: ", userId);
      // Persist the refreshed token back through to the engine's
      // settings table. Without this, the in-memory provider stays
      // current but the row stored in dbproxy keeps the original
      // (pre-refresh) access_token + refresh_token; an engine restart
      // would load that stale row and have to refresh again — fragile
      // if Twitch ever invalidates the original refresh_token.
      if (this.args.setSetting) {
        try {
          const persisted = { ...token, userId };
          await this.args.setSetting("twitch_token", JSON.stringify(persisted));
        } catch (err) {
          console.error("failed to persist refreshed twitch_token: ", err);
        }
      }
    });

    authProvider.onRefreshFailure((userId, error) => {
      console.log("failed to refresh token for: ", userId);
      console.error(error);
    });

    const response = await this.getBroadcasterToken();
    this.linkedUserId = await authProvider.addUserForToken(response, ["chat"]);

    return authProvider;
  }
}
