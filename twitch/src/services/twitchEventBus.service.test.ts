import { describe, expect, mock, test } from "bun:test";
import TwitchEventBusService from "./twitchEventBus";

/** A bus stub that reports itself fully subscribed. */
function readyClient() {
  return {
    start: mock(async () => {}),
    disconnect: mock(() => {}),
    isReady: mock(() => true),
    establishedCount: mock(() => 10),
    failedSubscriptions: mock(() => []),
  };
}

/** A bus stub whose subscriptions Twitch refused. */
function refusedClient() {
  return {
    start: mock(async () => {}),
    disconnect: mock(() => {}),
    isReady: mock(() => false),
    establishedCount: mock(() => 0),
    failedSubscriptions: mock(() => [{ id: "sub-1", reason: "Encountered HTTP status code 429: Too Many Requests" }]),
  };
}

describe("TwitchEventBusService", () => {
  test("connect starts the underlying EventSub bus once; repeat connect is a no-op", async () => {
    const client = readyClient();
    const svc = new TwitchEventBusService(client as never);

    await svc.connect();
    await svc.connect();

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
    expect(svc.healthcheck).toBe(true);
  });

  test("connect throws when Twitch refused the subscriptions", async () => {
    // The socket opens fine, so without this check a listener that
    // receives nothing would report as a healthy dependency.
    const client = refusedClient();
    const svc = new TwitchEventBusService(client as never);

    await expect(svc.connect()).rejects.toThrow(/429/);
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test("a failed connect does not latch; a later connect can succeed", async () => {
    const client = refusedClient();
    const svc = new TwitchEventBusService(client as never);
    await expect(svc.connect()).rejects.toThrow();

    client.isReady = mock(() => true);
    await svc.connect();

    expect(svc.connected).toBe(true);
    expect(svc.healthcheck).toBe(true);
  });

  test("disconnect stops the client when connected; repeat disconnect is safe", async () => {
    const client = readyClient();
    const svc = new TwitchEventBusService(client as never);

    await svc.disconnect();
    expect(client.disconnect).not.toHaveBeenCalled();

    await svc.connect();
    await svc.disconnect();
    await svc.disconnect();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });
});
