import type BarkloaderClient from "@woofx3/barkloader";
import type { Service } from "@woofx3/common/runtime";

const POLL_INTERVAL_MS = 100;
const CONNECTION_TIMEOUT_MS = 5000;

export default class BarkloaderClientService implements Service<BarkloaderClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: BarkloaderClient;
  connected: boolean;
  private connectionError: Error | null = null;

  constructor(client: BarkloaderClient) {
    this.healthcheck = false;
    this.name = "barkloader";
    this.type = "barkloader";
    this.client = client;
    this.connected = false;

    this.client.registerHandler("onError", (event: unknown) => {
      this.connectionError = new Error(String(event));
      this.connected = false;
      this.healthcheck = false;
    });

    this.client.registerHandler("onClose", () => {
      this.connected = false;
      this.healthcheck = false;
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.connectionError = null;
    this.client.connect();

    try {
      await new Promise<void>((resolve, reject) => {
        let elapsed = 0;

        const check = () => {
          if (this.client.isConnected()) {
            this.connected = true;
            this.healthcheck = true;
            this.connectionError = null;
            resolve();
            return;
          }

          if (this.connectionError) {
            reject(this.connectionError);
            return;
          }

          elapsed += POLL_INTERVAL_MS;
          if (elapsed >= CONNECTION_TIMEOUT_MS) {
            reject(new Error(`Barkloader connection timeout after ${CONNECTION_TIMEOUT_MS}ms`));
            return;
          }

          setTimeout(check, POLL_INTERVAL_MS);
        };

        setTimeout(check, POLL_INTERVAL_MS);
      });
    } catch (err) {
      this.client.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.client.destroy();
    this.connected = false;
    this.healthcheck = false;
  }
}
