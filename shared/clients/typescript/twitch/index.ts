import { ApiClient, type HelixUser } from "@twurple/api";
import type { AccessTokenWithUserId } from "@twurple/auth";
import { RefreshingAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import { EventSubWsListener } from "@twurple/eventsub-ws";

export type { ApiClient } from "@twurple/api";
export type { ChatClient, ChatMessage } from "@twurple/chat";
export type { EventSubWsListener } from "@twurple/eventsub-ws";

export type GetSettingFn = (req: { key: string; applicationId: string }) => Promise<{ setting: { value: { stringValue?: string } } }>;

export type TwitchClientArgs = {
  applicationId: string;
  channel: string;
  getSetting: GetSettingFn;
};

export type TwitchAuthCredentials = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

async function GetBroadcasterToken(applicationId: string, getSetting: GetSettingFn): Promise<AccessTokenWithUserId> {
  const response = await getSetting({
    applicationId,
    key: "twitch_token",
  });
  const token = response.setting.value.stringValue;
  if (!token) {
    throw new Error("Missing broadcaster token in db proxy setting: twitch_token");
  }
  return JSON.parse(token) satisfies AccessTokenWithUserId;
}

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

  private async authenticate(credentials: TwitchAuthCredentials): Promise<RefreshingAuthProvider> {
    const authProvider = new RefreshingAuthProvider(credentials);

    authProvider.onRefresh(([userId, _token]) => {
      console.log("refreshing token for: ", userId);
    });

    authProvider.onRefreshFailure(([userId, error]) => {
      console.log("failed to refresh token for: ", userId);
      console.error(error);
    });

    const response = await GetBroadcasterToken(this.args.applicationId, this.args.getSetting);
    await authProvider.addUserForToken(response, ["chat"]);

    return authProvider;
  }
}
