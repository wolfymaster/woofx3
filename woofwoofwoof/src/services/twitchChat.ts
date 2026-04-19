import type { Service } from "@woofx3/common/runtime";
import TwitchClient, { type ChatClient, type GetSettingFn, type TwitchAuthCredentials } from "@woofx3/twitch";

export interface TwitchChatConfig {
  applicationId: string;
  channel: string;
  credentials: TwitchAuthCredentials;
  getSetting: GetSettingFn;
}

export default class TwitchChatClientService implements Service<ChatClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client!: ChatClient;
  connected: boolean;
  private config: TwitchChatConfig;

  constructor(config: TwitchChatConfig) {
    this.healthcheck = false;
    this.name = "twitchchat";
    this.type = "twitchchat";
    this.connected = false;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const twitchClient = new TwitchClient({
      channel: this.config.channel,
      getSetting: this.config.getSetting,
    });

    await twitchClient.init(this.config.credentials);

    this.client = twitchClient.ChatClient();
    this.client.connect();
    this.connected = true;
    this.healthcheck = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.client.quit();
    this.connected = false;
    this.healthcheck = false;
  }
}
