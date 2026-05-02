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
  channel: string;
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

export default class TwitchClient {
  private authProvider: RefreshingAuthProvider | null;
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

  ChatClient(): ChatClient {
    if (!this.authProvider) {
      throw new Error("Must initialize TwitchClient before use");
    }

    return new ChatClient({
      authProvider: this.authProvider,
      channels: [this.args.channel],
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

  async broadcaster(): Promise<HelixUser> {
    const user = await this.ApiClient().users.getUserByName({ name: this.args.channel });
    if (!user) {
      throw new Error(`Failed to retrieve Twitch Helix user: ${this.args.channel}`);
    }
    return user;
  }

  private async getBroadcasterToken(): Promise<AccessTokenWithUserId> {
    const token = await this.args.getSetting("twitch_token");
    if (!token) {
      throw new Error("Missing broadcaster token in db proxy setting: twitch_token");
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
    await authProvider.addUserForToken(response, ["chat"]);

    return authProvider;
  }
}
