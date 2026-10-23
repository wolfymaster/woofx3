import type { Service } from "@woofx3/common/runtime";
import type NATSClient from "@woofx3/nats/src/client";
import { errorMessage, type Logger } from "../host/deps";

/**
 * The host's one bus connection. Tracks whether it is up from the client's
 * status events, so /health can fail while the bus is down.
 */
export default class MessageBusService implements Service<NATSClient> {
  readonly healthcheck = false;
  readonly name = "messageBus";
  readonly type = "nats";
  connected = false;
  private reachable = false;
  /** The status loop, which ends when the connection closes; disconnect waits for it. */
  private statusWatch: Promise<void> | undefined;

  constructor(
    readonly client: NATSClient,
    private readonly logger: Logger
  ) {}

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect();
    this.connected = true;
    this.reachable = true;
    // A status stream that fails leaves nothing to tell us the bus came back, so report it down.
    this.statusWatch = this.watchStatus().catch((error: unknown) => {
      this.logger.error("bus status stream failed; reporting the bus down from now on", {
        error: errorMessage(error),
      });
      this.reachable = false;
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.reachable = false;
    await this.client.close();
    // Closing the connection ends its status stream, so this settles; the loop's own catch logs any failure.
    const statusWatch = this.statusWatch;
    this.statusWatch = undefined;
    await statusWatch;
  }

  /** Connected and not between a drop and its reconnect. */
  isUp(): boolean {
    const connection = this.client.asNATS();
    return this.connected && this.reachable && connection !== null && !connection.isClosed();
  }

  private async watchStatus(): Promise<void> {
    const connection = this.client.asNATS();
    if (connection === null) {
      return;
    }
    for await (const status of connection.status()) {
      if (status.type === "disconnect") {
        this.reachable = false;
      } else if (status.type === "reconnect") {
        this.reachable = true;
      }
    }
  }
}
