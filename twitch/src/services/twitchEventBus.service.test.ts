import { describe, expect, mock, test } from "bun:test";
import TwitchEventBusService from "./twitchEventBus";

describe("TwitchEventBusService", () => {
  test("connect starts the underlying EventSub bus once; repeat connect is a no-op", async () => {
    const start = mock(() => {});
    const disconnect = mock(() => {});
    const client = { start, disconnect };

    const svc = new TwitchEventBusService(client as never);

    await svc.connect();
    await svc.connect();

    expect(start).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
  });

  test("disconnect stops the client when connected; repeat disconnect is safe", async () => {
    const start = mock(() => {});
    const disconnect = mock(() => {});
    const client = { start, disconnect };

    const svc = new TwitchEventBusService(client as never);

    await svc.disconnect();
    expect(disconnect).not.toHaveBeenCalled();

    await svc.connect();
    await svc.disconnect();
    await svc.disconnect();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
  });
});
