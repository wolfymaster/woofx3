import type { Service } from "@woofx3/common/runtime";
import type { ChatClient } from "@woofx3/twitch";

export default class TwitchChatClientService implements Service<ChatClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: ChatClient;
  connected: boolean;

  constructor(client: ChatClient) {
    this.healthcheck = false;
    this.name = "twitchchat";
    this.type = "twitchchat";
    this.client = client;
    this.connected = false;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.client.quit();
    this.connected = false;
  }
}
