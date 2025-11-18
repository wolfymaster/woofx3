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
    this.name = 'twitchchat';
    this.type = 'twitchchat';
    this.client = client;
    this.connected = false;
  }

  async connect(): Promise<void> {
    this.client.connect();
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }
}