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
    this.name = 'twitchchat';
    this.type = 'twitchchat';
    this.client = client;
    this.connected = false;
  }

  async connect(): Promise<void> {
    this.client.connect();
  }

  async disconnect(): Promise<void> {
    this.client.quit();
  }
}