import type { Service } from "@woofx3/common/runtime";
import type TwitchEventBus from "src/lib/twitchEventBus";

export default class TwitchEventBusService implements Service<TwitchEventBus> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: TwitchEventBus;
  connected: boolean;

  constructor(client: TwitchEventBus) {
    this.healthcheck = false;
    this.name = 'twitchEventBus';
    this.type = 'twitchapi';
    this.client = client;
    this.connected = false;
  }

  async connect(): Promise<void> {
    this.client.connect();
    this.connected = true;
  }
  
  async disconnect(): Promise<void> { 
    this.client.disconnect();
    this.connected = false;
  }
}
