import type BarkloaderClient from "@woofx3/barkloader";
import type { Service } from "@woofx3/common/runtime";

export default class BarkloaderClientService implements Service<BarkloaderClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: BarkloaderClient;
  connected: boolean;

  constructor(client: BarkloaderClient) {
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
    this.client.destroy();
    this.connected = false;
  }
}
