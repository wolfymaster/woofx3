import type { Service } from "@woofx3/common/runtime";
import type TwitchClient from "@woofx3/twitch";

export default class TwitchService implements Service<TwitchClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: TwitchClient;
  connected: boolean;

  constructor(client: TwitchClient) {
    this.healthcheck = false;
    this.name = 'messageBus';
    this.type = 'nats';
    this.client = client;
    this.connected = false;
  }

  async connect(): Promise<void> {
    
    this.connected = true;
  }
  
  async disconnect(): Promise<void> { 
    await this.client.close();
    this.connected = false;
  }
}