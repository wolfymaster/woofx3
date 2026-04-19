import { describe, expect, mock, test } from "bun:test";
import MessageBusService from "./messageBus";

describe("MessageBusService", () => {
  test("starts disconnected and exposes stable service identity for health/runtime", () => {
    const nats = {
      connect: mock(async () => {}),
      close: mock(async () => {}),
    };
    const svc = new MessageBusService(nats as never);

    expect(svc.name).toBe("messageBus");
    expect(svc.type).toBe("nats");
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
    expect(svc.client).toBe(nats);
  });

  test("connect establishes the NATS client once and marks the service as connected", async () => {
    const nats = {
      connect: mock(async () => {}),
      close: mock(async () => {}),
    };
    const svc = new MessageBusService(nats as never);

    await svc.connect();

    expect(nats.connect).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
  });

  test("connect is idempotent: does not call connect again while already connected", async () => {
    const nats = {
      connect: mock(async () => {}),
      close: mock(async () => {}),
    };
    const svc = new MessageBusService(nats as never);

    await svc.connect();
    await svc.connect();

    expect(nats.connect).toHaveBeenCalledTimes(1);
  });

  test("disconnect closes the client and clears connection state", async () => {
    const nats = {
      connect: mock(async () => {}),
      close: mock(async () => {}),
    };
    const svc = new MessageBusService(nats as never);
    await svc.connect();

    await svc.disconnect();

    expect(nats.close).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
  });

  test("disconnect when already disconnected is a safe no-op", async () => {
    const nats = {
      connect: mock(async () => {}),
      close: mock(async () => {}),
    };
    const svc = new MessageBusService(nats as never);

    await svc.disconnect();

    expect(nats.close).not.toHaveBeenCalled();
  });
});
