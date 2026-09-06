import type { Service } from "@woofx3/common/runtime";
import TwitchEventBus from "src/lib/twitchEventBus";

export default class TwitchEventBusService implements Service<TwitchEventBus> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: TwitchEventBus;
  connected: boolean;

  constructor(client: TwitchEventBus) {
    this.healthcheck = false;
    this.name = "twitchEventBus";
    this.type = "twitchapi";
    this.client = client;
    this.connected = false;
  }

  /**
   * Starting the socket is not the same as being usable: Twitch can accept
   * the connection and refuse every subscription on it. Registered as a
   * required service, throwing here stops the runtime from reaching ready
   * rather than letting a silent listener pass for a working one.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.start();
    if (!this.client.isReady()) {
      this.healthcheck = false;
      throw new Error(
        `Twitch EventSub subscriptions incomplete (${this.client.establishedCount()}/${
          TwitchEventBus.expectedSubscriptionCount
        } established): ${this.client.failedSubscriptions().map((f) => f.reason).join("; ")}`
      );
    }
    this.healthcheck = true;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.client.disconnect();
    this.connected = false;
    this.healthcheck = false;
  }
}
