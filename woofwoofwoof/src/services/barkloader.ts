import type BarkloaderClient from "@woofx3/barkloader";
import type { Service } from "@woofx3/common/runtime";

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
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Track connection errors
    const handleError = (event: unknown) => {
      console.log("Barkloader connection error:", event);
      this.connectionError = new Error(String(event));
      this.connected = false;
      this.healthcheck = false;
    };

    // Track close events
    const handleClose = () => {
      console.log("Barkloader connection closed");
      this.connected = false;
      this.healthcheck = false;
    };

    this.client.registerHandler("onError", handleError);

    this.client.connect();

    // Wait for connection with timeout
    await new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      const checkInterval = 100;

      const checkConnection = () => {
        elapsed += checkInterval;

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

        if (elapsed >= CONNECTION_TIMEOUT_MS) {
          reject(new Error(`Connection timeout after ${CONNECTION_TIMEOUT_MS}ms`));
          return;
        }

        setTimeout(checkConnection, checkInterval);
      };

      setTimeout(checkConnection, checkInterval);
    });

    if (!this.connected) {
      throw new Error("Failed to connect to barkloader");
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
