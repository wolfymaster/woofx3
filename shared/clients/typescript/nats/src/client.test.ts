import { describe, expect, test } from "bun:test";
import { type AddressInfo, createServer } from "node:net";
import type { ConnectionOptions, NatsConnection } from "@nats-io/nats-core";
import { wsconnect } from "@nats-io/nats-core";
import NATSClient, { type ClientDeps, connectOptions, DEFAULT_RECONNECT_POLICY } from "./client";
import type { Logger } from "./types";

describe("connectOptions", () => {
  test("sends the configured token", () => {
    const options = connectOptions({ url: "ws://127.0.0.1:4225", name: "test", token: "s3cret" });
    expect(options.token).toBe("s3cret");
  });

  test("sends no token when none is configured", () => {
    expect(connectOptions({ url: "ws://127.0.0.1:4225", name: "test" }).token).toBeUndefined();
    expect(connectOptions({ url: "ws://127.0.0.1:4225", name: "test", token: "  " }).token).toBeUndefined();
  });

  test("reconnects forever at the default pace", () => {
    const options = connectOptions({ url: "ws://127.0.0.1:4225", name: "test" });
    expect(options.maxReconnectAttempts).toBe(-1);
    expect(options.waitOnFirstConnect).toBe(false);
    expect(options.reconnectTimeWait).toBe(DEFAULT_RECONNECT_POLICY.reconnectTimeWaitMs);
    expect(options.reconnectJitter).toBe(DEFAULT_RECONNECT_POLICY.reconnectJitterMs);
    expect(options.reconnectJitterTLS).toBe(DEFAULT_RECONNECT_POLICY.reconnectJitterMs);
  });

  test("uses a configured reconnect policy", () => {
    const reconnect = { reconnectTimeWaitMs: 250, reconnectJitterMs: 0, firstConnectAttempts: 3 };
    const options = connectOptions({ url: "ws://127.0.0.1:4225", name: "test", reconnect });
    expect(options.reconnectTimeWait).toBe(250);
    expect(options.reconnectJitter).toBe(0);
  });

  test.each([
    { reconnectTimeWaitMs: 0, reconnectJitterMs: 0, firstConnectAttempts: 1 },
    { reconnectTimeWaitMs: 1.5, reconnectJitterMs: 0, firstConnectAttempts: 1 },
    { reconnectTimeWaitMs: 1000, reconnectJitterMs: -1, firstConnectAttempts: 1 },
    { reconnectTimeWaitMs: Number.NaN, reconnectJitterMs: 0, firstConnectAttempts: 1 },
    { reconnectTimeWaitMs: 1000, reconnectJitterMs: 0, firstConnectAttempts: 0 },
  ])("refuses the reconnect policy %o", (reconnect) => {
    expect(() => connectOptions({ url: "ws://127.0.0.1:4225", name: "test", reconnect })).toThrow();
  });
});

type LogLine = { level: keyof Logger; message: string };

function recordingLogger(): Logger & { lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record =
    (level: keyof Logger) =>
    (message: string): void => {
      lines.push({ level, message });
    };
  return { lines, info: record("info"), warn: record("warn"), debug: record("debug"), error: record("error") };
}

/** A connection that only publishes and closes; closing settles closed(). */
class FakeConnection {
  readonly published: string[] = [];
  private settle: (error: Error | undefined) => void = () => {};
  private readonly done = new Promise<Error | undefined>((resolve) => {
    this.settle = resolve;
  });

  publish(subject: string): void {
    this.published.push(subject);
  }

  closed(): Promise<Error | undefined> {
    return this.done;
  }

  async close(): Promise<void> {
    this.settle(undefined);
  }

  /** The library giving up on the connection. */
  fail(error: Error): void {
    this.settle(error);
  }
}

/** The one connection a test expects the client to have dialled. */
function onlyConnection(connections: FakeConnection[]): FakeConnection {
  expect(connections).toHaveLength(1);
  const [connection] = connections;
  if (connection === undefined) {
    throw new Error("no connection was dialled");
  }
  return connection;
}

const noSleep = async (): Promise<void> => {};

/** A dial that hands out fake connections, resolving each when the test says. */
function fakeDialer(): { deps: ClientDeps; connections: FakeConnection[]; answer: () => void } {
  const connections: FakeConnection[] = [];
  const pending: Array<() => void> = [];
  const dial = (_options: ConnectionOptions): Promise<NatsConnection> => {
    const connection = new FakeConnection();
    connections.push(connection);
    return new Promise((resolve) => {
      pending.push(() => resolve(connection as unknown as NatsConnection));
    });
  };
  const answer = (): void => {
    for (const resolve of pending.splice(0)) {
      resolve();
    }
  };
  return { deps: { dial, sleep: noSleep }, connections, answer };
}

const config = { url: "ws://127.0.0.1:4225", name: "test" };

describe("NATSClient", () => {
  test("concurrent callers share one dial", async () => {
    const dialer = fakeDialer();
    const client = new NATSClient(config, recordingLogger(), dialer.deps);

    const calls = [client.connect(), client.publish("a", new Uint8Array()), client.publish("b", new Uint8Array())];
    dialer.answer();
    await Promise.all(calls);

    expect(dialer.connections).toHaveLength(1);
    expect(onlyConnection(dialer.connections).published).toEqual(["a", "b"]);
  });

  /** A dial refused `refusals` times before it connects; sleep records each pause. */
  function refusingDeps(refusals: number): ClientDeps & { attempts: () => number; pauses: number[] } {
    let attempts = 0;
    const pauses: number[] = [];
    return {
      attempts: () => attempts,
      pauses,
      dial: async () => {
        attempts += 1;
        if (attempts <= refusals) {
          throw new Error("refused");
        }
        return new FakeConnection() as unknown as NatsConnection;
      },
      sleep: async (ms) => {
        pauses.push(ms);
      },
    };
  }

  test("the first dial is retried while the bus is not listening", async () => {
    const deps = refusingDeps(2);
    const client = new NATSClient(config, recordingLogger(), deps);

    await client.connect();

    expect(deps.attempts()).toBe(3);
    expect(deps.pauses).toEqual([
      DEFAULT_RECONNECT_POLICY.reconnectTimeWaitMs,
      DEFAULT_RECONNECT_POLICY.reconnectTimeWaitMs,
    ]);
  });

  test("a first dial out of attempts rejects, and the next call starts over", async () => {
    const deps = refusingDeps(2);
    const logger = recordingLogger();
    const reconnect = { ...DEFAULT_RECONNECT_POLICY, firstConnectAttempts: 2 };
    const client = new NATSClient({ ...config, reconnect }, logger, deps);

    await expect(client.connect()).rejects.toThrow("refused");
    expect(logger.lines).toContainEqual({ level: "error", message: "Failed to connect to NATS" });
    await client.publish("a", new Uint8Array());

    expect(deps.attempts()).toBe(3);
    expect(client.isClosed()).toBe(false);
  });

  test("a connection the library gives up on closes the client for good", async () => {
    const dialer = fakeDialer();
    const logger = recordingLogger();
    const client = new NATSClient(config, logger, dialer.deps);
    const connecting = client.connect();
    dialer.answer();
    await connecting;

    onlyConnection(dialer.connections).fail(new Error("authorization violation"));
    await Bun.sleep(0);

    expect(client.isClosed()).toBe(true);
    expect(client.asNATS()).toBeNull();
    expect(logger.lines).toContainEqual({ level: "error", message: "NATS connection closed" });
    await expect(client.publish("late", new Uint8Array())).rejects.toThrow("NATS connection is closed");
    expect(dialer.connections).toHaveLength(1);
  });

  test("close() closes the client and is logged as intended", async () => {
    const dialer = fakeDialer();
    const logger = recordingLogger();
    const client = new NATSClient(config, logger, dialer.deps);
    const connecting = client.connect();
    dialer.answer();
    await connecting;

    await client.close();
    await Bun.sleep(0);

    expect(client.isClosed()).toBe(true);
    expect(logger.lines).toContainEqual({ level: "info", message: "NATS connection closed" });
    await expect(client.connect()).rejects.toThrow("NATS connection is closed");
  });

  test("close() during the first dial closes the connection it brings", async () => {
    const dialer = fakeDialer();
    const client = new NATSClient(config, recordingLogger(), dialer.deps);
    const connecting = client.connect();

    await client.close();
    dialer.answer();

    await expect(connecting).rejects.toThrow("NATS connection is closed");
    expect(await onlyConnection(dialer.connections).closed()).toBeUndefined();
    expect(client.asNATS()).toBeNull();
  });
});

/** The head of the WebSocket upgrade request wsconnect sends, read off a socket that never upgrades. */
async function upgradeRequest(): Promise<string> {
  let resolveHead: (head: string) => void = () => {};
  const head = new Promise<string>((resolve) => {
    resolveHead = resolve;
  });
  const server = createServer((socket) => {
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      if (received.includes("\r\n\r\n")) {
        resolveHead(received);
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const attempt = wsconnect({ servers: `ws://127.0.0.1:${port}`, reconnect: false, timeout: 2000 }).catch(() => null);
    const request = await head;
    await attempt;
    return request;
  } finally {
    server.close();
  }
}

describe("WebSocket upgrade", () => {
  // The message bus's same-origin check rejects only an upgrade whose Origin
  // names another host, so a client that sends none is unaffected by it.
  test("carries no Origin header under Bun", async () => {
    const request = (await upgradeRequest()).toLowerCase();

    expect(request).toContain("upgrade: websocket");
    expect(request).not.toContain("\r\norigin:");
  });
});
