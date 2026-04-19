import { describe, expect, mock, test } from "bun:test";
import type BarkloaderClient from "@woofx3/barkloader";
import BarkloaderClientService from "./barkloader";

const POLL_MS = 100;
const TIMEOUT_MS = 5000;

function createBarkloaderStub(options: { connectedAfterConnect?: boolean }) {
  const handlers: Record<string, (e: unknown) => void> = {};
  let connected = options.connectedAfterConnect ?? false;

  const stub = {
    registerHandler: (name: string, fn: (e: unknown) => void) => {
      handlers[name] = fn;
    },
    connect: mock(() => {
      connected = options.connectedAfterConnect ?? true;
    }),
    isConnected: () => connected,
    disconnect: mock(() => {}),
    destroy: mock(() => {}),
    handlers,
    setConnected: (v: boolean) => {
      connected = v;
    },
  };

  return stub;
}

describe("BarkloaderClientService", () => {
  test("starts disconnected and registers socket lifecycle handlers", () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: false });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);

    expect(svc.name).toBe("barkloader");
    expect(svc.type).toBe("barkloader");
    expect(svc.connected).toBe(false);
    expect(stub.handlers.onError).toBeDefined();
    expect(stub.handlers.onClose).toBeDefined();
  });

  test("connect resolves when the client reports connected within the wait window", async () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: true });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);

    await svc.connect();

    expect(stub.connect).toHaveBeenCalled();
    expect(svc.connected).toBe(true);
    expect(svc.healthcheck).toBe(true);
  });

  test("connect is idempotent while already connected", async () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: true });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);
    await svc.connect();

    await svc.connect();

    expect(stub.connect).toHaveBeenCalledTimes(1);
  });

  test("socket error before connect completes rejects and disconnects the client", async () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: false });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);

    const p = svc.connect();
    stub.handlers.onError?.("ws failed");

    await expect(p).rejects.toThrow();
    expect(stub.disconnect).toHaveBeenCalled();
    expect(svc.connected).toBe(false);
  });

  test("disconnect destroys the client and clears state when connected", async () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: true });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);
    await svc.connect();

    await svc.disconnect();

    expect(stub.destroy).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test("disconnect when not connected does not call destroy", async () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: false });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);

    await svc.disconnect();

    expect(stub.destroy).not.toHaveBeenCalled();
  });

  test("onClose marks the service disconnected", async () => {
    const stub = createBarkloaderStub({ connectedAfterConnect: true });
    const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);
    await svc.connect();
    expect(svc.connected).toBe(true);

    stub.handlers.onClose?.();

    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test(
    "abandons connect after the configured timeout when the socket never becomes ready",
    async () => {
      const stub = createBarkloaderStub({ connectedAfterConnect: false });
      const svc = new BarkloaderClientService(stub as unknown as BarkloaderClient);

      const p = svc.connect();

      await expect(p).rejects.toThrow(new RegExp(String(TIMEOUT_MS)));
      expect(stub.disconnect).toHaveBeenCalled();
    },
    { timeout: POLL_MS + TIMEOUT_MS + 2000 }
  );
});
