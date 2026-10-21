import type { ConnectionOptions, Msg as NatsCoreMsg, NatsConnection, Subscription } from "@nats-io/nats-core";
import { jwtAuthenticator, wsconnect } from "@nats-io/nats-core";
import { MessageImpl } from "./msg";
import type { Handler, Logger, Msg, NATSConfig, ReconnectPolicy } from "./types";

/** The reconnect policy a config gets when it names none. The pace matches the Go client's. */
export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  reconnectTimeWaitMs: 1000,
  reconnectJitterMs: 500,
  firstConnectAttempts: 30,
};

/** What a client needs from the outside world; production uses DEFAULT_CLIENT_DEPS. */
export interface ClientDeps {
  dial: (options: ConnectionOptions) => Promise<NatsConnection>;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_CLIENT_DEPS: ClientDeps = {
  dial: wsconnect,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

function assertReconnectPolicy(policy: ReconnectPolicy): void {
  if (!Number.isInteger(policy.reconnectTimeWaitMs) || policy.reconnectTimeWaitMs <= 0) {
    throw new Error(`reconnectTimeWaitMs must be a positive integer, got ${policy.reconnectTimeWaitMs}`);
  }
  if (!Number.isInteger(policy.reconnectJitterMs) || policy.reconnectJitterMs < 0) {
    throw new Error(`reconnectJitterMs must be a non-negative integer, got ${policy.reconnectJitterMs}`);
  }
  if (!Number.isInteger(policy.firstConnectAttempts) || policy.firstConnectAttempts <= 0) {
    throw new Error(`firstConnectAttempts must be a positive integer, got ${policy.firstConnectAttempts}`);
  }
}

function reconnectPolicy(config: NATSConfig): ReconnectPolicy {
  const policy = config.reconnect ?? DEFAULT_RECONNECT_POLICY;
  assertReconnectPolicy(policy);
  return policy;
}

/** The connect options a config asks for. Throws on an invalid reconnect policy. */
export function connectOptions(
  config: NATSConfig,
  policy: ReconnectPolicy = reconnectPolicy(config)
): ConnectionOptions {
  const options: ConnectionOptions = {
    name: config.name,
    servers: config.url,
    // The first dial fails at once when the bus is not listening, and the
    // client retries it a bounded number of times (firstConnectAttempts).
    // nats-core would apply maxReconnectAttempts to those retries too, so a
    // service that can run without the bus would wait for it forever.
    waitOnFirstConnect: false,
    // Once connected, a service outlives any bus outage: the connection keeps
    // reconnecting, buffering what is published meanwhile and restoring its
    // subscriptions.
    maxReconnectAttempts: -1,
    reconnectTimeWait: policy.reconnectTimeWaitMs,
    reconnectJitter: policy.reconnectJitterMs,
    reconnectJitterTLS: policy.reconnectJitterMs,
  };

  if (config.jwt && config.nkeySeed) {
    options.authenticator = jwtAuthenticator(config.jwt, Buffer.from(config.nkeySeed));
  }

  const token = config.token?.trim();
  if (token) {
    options.token = token;
  }

  return options;
}

/**
 * A client owns one connection for its whole life. It is dialled once, on
 * first use, and shared by every caller; the connection reconnects by itself.
 * Once it closes (after close(), or a failure the library gives up on) the
 * client is closed for good and every call throws: dialling a fresh
 * connection would silently drop every subscription made on the old one.
 */
export default class NATSClient {
  private connection: NatsConnection | null = null;
  private dialing: Promise<NatsConnection> | null = null;
  private closed = false;
  private readonly policy: ReconnectPolicy;

  /** Throws when config.reconnect is not a valid policy. */
  constructor(
    private readonly config: NATSConfig,
    private readonly logger: Logger,
    private readonly deps: ClientDeps = DEFAULT_CLIENT_DEPS
  ) {
    this.policy = reconnectPolicy(config);
  }

  async connect(): Promise<void> {
    await this.connected();
  }

  /** True once the connection has closed; a closed client cannot be used again. */
  isClosed(): boolean {
    return this.closed;
  }

  private connected(): Promise<NatsConnection> {
    if (this.closed) {
      return Promise.reject(new Error("NATS connection is closed"));
    }
    if (this.connection) {
      return Promise.resolve(this.connection);
    }
    if (!this.dialing) {
      this.dialing = this.dialOnce();
    }
    return this.dialing;
  }

  /**
   * Dial the first connection, retrying while the bus is not listening yet:
   * in local dev the bus and its dependents start in parallel with no
   * ordering guarantee. A dial that runs out of attempts clears the memo, so
   * a later call starts over.
   */
  private async dialOnce(): Promise<NatsConnection> {
    const policy = this.policy;
    const options = connectOptions(this.config, policy);
    let connection: NatsConnection | null = null;
    for (let attempt = 1; connection === null; attempt++) {
      if (this.closed) {
        this.dialing = null;
        throw new Error("NATS connection is closed");
      }
      try {
        connection = await this.deps.dial(options);
      } catch (error) {
        if (attempt >= policy.firstConnectAttempts || this.closed) {
          this.dialing = null;
          this.logger.error("Failed to connect to NATS", {
            name: options.name,
            attempts: attempt,
            error: describeError(error),
          });
          throw error;
        }
        this.logger.info("NATS is not accepting connections yet; retrying", {
          name: options.name,
          attempt,
          attempts: policy.firstConnectAttempts,
          error: describeError(error),
        });
        await this.deps.sleep(policy.reconnectTimeWaitMs);
      }
    }
    if (this.closed) {
      // close() ran while the dial was in flight.
      await connection.close();
      throw new Error("NATS connection is closed");
    }
    this.connection = connection;
    this.logger.info("Connected to NATS", { url: options.servers, name: options.name });
    void this.watchClosed(connection);
    return connection;
  }

  private async watchClosed(connection: NatsConnection): Promise<void> {
    const error = await connection.closed();
    const intentional = this.closed;
    this.closed = true;
    this.connection = null;
    this.dialing = null;
    if (error) {
      this.logger.error("NATS connection closed", { name: this.config.name, error: describeError(error) });
      return;
    }
    if (intentional) {
      this.logger.info("NATS connection closed", { name: this.config.name });
      return;
    }
    this.logger.error("NATS connection closed unexpectedly", { name: this.config.name });
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    const connection = await this.connected();
    connection.publish(subject, data);
    this.logger.debug("Published message", { subject, size: data.length });
  }

  /**
   * NATS request/reply: publishes to `subject` with an inbox reply subject
   * managed internally by the NATS client (muxed inbox), waits for the
   * first response, and resolves with the reply Msg. Workers that handle
   * the request should reply via `msg.respond(data)`.
   */
  async request(
    subject: string,
    data: Uint8Array,
    opts?: { timeout?: number }
  ): Promise<{ subject: string; data: Uint8Array }> {
    const connection = await this.connected();
    const reply = await connection.request(subject, data, {
      timeout: opts?.timeout ?? 10_000,
    });
    return { subject: reply.subject, data: reply.data };
  }

  async subscribe(subject: string, handler: Handler): Promise<Subscription> {
    const connection = await this.connected();
    const subscription = connection.subscribe(subject);
    this.logger.debug("Subscribed to subject", { subject });

    void consumeMessages(subject, subscription, handler, this.logger);

    return subscription;
  }

  /**
   * Call `handler` each time the connection comes back after a drop. Messages
   * published while it was down were not delivered, so a consumer that
   * mirrors state from events uses this to resynchronise.
   */
  async onReconnect(handler: () => void): Promise<void> {
    const connection = await this.connected();
    const status = connection.status();
    (async () => {
      try {
        for await (const event of status) {
          if (event.type === "reconnect") {
            handler();
          }
        }
      } catch (error) {
        this.logger.error("Connection status watch error", { error: describeError(error) });
      }
    })();
  }

  async close(): Promise<void> {
    this.closed = true;
    const connection = this.connection;
    if (connection) {
      await connection.close();
    }
  }

  asNATS(): NatsConnection | null {
    return this.connection;
  }
}

/**
 * Hand each message of a subscription to its handler until the subscription
 * ends. A handler that throws, or whose promise rejects, is logged with the
 * subject and the loop goes on to the next message: one bad message must not
 * end the subscription for every message after it. Handlers are not awaited,
 * so a slow one never holds up the messages behind it.
 */
export async function consumeMessages(
  subject: string,
  messages: AsyncIterable<NatsCoreMsg>,
  handler: Handler,
  logger: Logger
): Promise<void> {
  try {
    for await (const msg of messages) {
      dispatchMessage(subject, new MessageImpl(msg.subject, msg.data, msg), handler, logger);
    }
  } catch (error) {
    logger.error("subscription ended with an error", { subject, error: describeError(error) });
  }
}

function dispatchMessage(subject: string, msg: Msg, handler: Handler, logger: Logger): void {
  const fail = (error: unknown): void => {
    logger.error("subscription handler failed", {
      subject,
      messageSubject: msg.subject,
      error: describeError(error),
    });
  };
  let result: void | Promise<void>;
  try {
    result = handler(msg);
  } catch (error) {
    fail(error);
    return;
  }
  if (result instanceof Promise) {
    result.catch(fail);
  }
}

function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
