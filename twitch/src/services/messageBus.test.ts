import { describe, expect, mock, test } from "bun:test";
import MessageBusService from "./messageBus";

describe("MessageBusService", () => {
  test("connect awaits the NATS client once; repeat connect is a no-op", async () => {
    const connect = mock(async () => {});
    const close = mock(async () => {});
    const client = { connect, close };
    const svc = new MessageBusService(client as never);

    await svc.connect();
    await svc.connect();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
  });

  test("disconnect closes the client when connected; repeat disconnect is safe", async () => {
    const connect = mock(async () => {});
    const close = mock(async () => {});
    const client = { connect, close };
    const svc = new MessageBusService(client as never);

    await svc.disconnect();
    expect(close).not.toHaveBeenCalled();

    await svc.connect();
    await svc.disconnect();
    await svc.disconnect();

    expect(close).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
  });
});
