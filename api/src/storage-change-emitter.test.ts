import { describe, expect, it, mock } from "bun:test";
import { mapStorageChanged, StorageChangeEmitter } from "./storage-change-emitter";
import type { Msg } from "@woofx3/nats/src/types";
import { EngineEventType } from "@woofx3/api/webhooks";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function makeMsg(subject: string, body: unknown): Msg {
  const payload = JSON.stringify(body);
  return {
    subject,
    data: new TextEncoder().encode(payload),
    json: () => JSON.parse(payload),
    string: () => payload,
    respond: () => false,
  };
}

function setup() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    subscribe: mock(async (subject: string, handler: (msg: Msg) => void) => {
      handlers.set(subject, handler);
      return {} as any;
    }),
  } as any;
  const webhook = {
    send: mock(async () => {}),
  } as any;
  const emitter = new StorageChangeEmitter(nats, webhook, fakeLogger());
  return { emitter, nats, webhook, handlers };
}

describe("mapStorageChanged", () => {
  it("decodes a well-formed envelope", () => {
    const event = mapStorageChanged({
      specversion: "1.0",
      type: "module.storage.changed",
      source: "barkloader",
      id: "ev-1",
      time: "2026-05-03T00:00:00.000Z",
      data: {
        moduleId: "counter",
        key: "counter:state:count",
        value: 7,
        occurredAt: "2026-05-03T00:00:00.500Z",
      },
    });
    expect(event).toEqual({
      type: EngineEventType.MODULE_STORAGE_CHANGED,
      moduleId: "counter",
      key: "counter:state:count",
      value: 7,
      occurredAt: "2026-05-03T00:00:00.500Z",
    });
  });

  it("falls back to envelope time when occurredAt is missing", () => {
    const event = mapStorageChanged({
      type: "module.storage.changed",
      time: "2026-05-03T00:00:00.000Z",
      data: {
        moduleId: "counter",
        key: "k",
        value: null,
      },
    });
    expect(event?.occurredAt).toBe("2026-05-03T00:00:00.000Z");
  });

  it("returns null when moduleId is missing", () => {
    expect(
      mapStorageChanged({
        type: "module.storage.changed",
        data: { key: "k", value: 1 },
      })
    ).toBeNull();
  });

  it("returns null when key is missing", () => {
    expect(
      mapStorageChanged({
        type: "module.storage.changed",
        data: { moduleId: "counter", value: 1 },
      })
    ).toBeNull();
  });

  it("includes previousValue only when provided", () => {
    const withPrev = mapStorageChanged({
      type: "module.storage.changed",
      data: { moduleId: "m", key: "k", value: 2, previousValue: 1 },
    });
    expect(withPrev?.previousValue).toBe(1);

    const withoutPrev = mapStorageChanged({
      type: "module.storage.changed",
      data: { moduleId: "m", key: "k", value: 2 },
    });
    expect(withoutPrev && "previousValue" in withoutPrev).toBe(false);
  });

  it("preserves the value verbatim — strings, objects, arrays", () => {
    const obj = mapStorageChanged({
      type: "module.storage.changed",
      data: { moduleId: "m", key: "k", value: { nested: { count: 3 } } },
    });
    expect(obj?.value).toEqual({ nested: { count: 3 } });

    const arr = mapStorageChanged({
      type: "module.storage.changed",
      data: { moduleId: "m", key: "k", value: ["a", "b", "c"] },
    });
    expect(arr?.value).toEqual(["a", "b", "c"]);
  });
});

describe("StorageChangeEmitter wiring", () => {
  it("subscribes to the wildcard pattern on start", async () => {
    const { emitter, nats } = setup();
    await emitter.start();
    expect(nats.subscribe).toHaveBeenCalledTimes(1);
    expect(nats.subscribe.mock.calls[0][0]).toBe("module.storage.*.changed");
  });

  it("forwards a decoded event to webhook.send", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("module.storage.*.changed")!(
      makeMsg("module.storage.counter.changed", {
        specversion: "1.0",
        type: "module.storage.changed",
        source: "barkloader",
        id: "ev-1",
        time: "2026-05-03T00:00:00.000Z",
        data: {
          moduleId: "counter",
          key: "counter:state:count",
          value: 5,
          occurredAt: "2026-05-03T00:00:00.500Z",
        },
      })
    );
    await Promise.resolve();
    expect(webhook.send).toHaveBeenCalledTimes(1);
    expect(webhook.send).toHaveBeenCalledWith({
      type: EngineEventType.MODULE_STORAGE_CHANGED,
      moduleId: "counter",
      key: "counter:state:count",
      value: 5,
      occurredAt: "2026-05-03T00:00:00.500Z",
    });
  });

  it("drops malformed payloads without throwing or calling webhook", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("module.storage.*.changed")!(
      makeMsg("module.storage.counter.changed", {
        type: "module.storage.changed",
        data: { value: 5 },
      })
    );
    await Promise.resolve();
    expect(webhook.send).not.toHaveBeenCalled();
  });

  it("swallows non-JSON payloads", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    const badMsg: Msg = {
      subject: "module.storage.counter.changed",
      data: new TextEncoder().encode("not-json"),
      json: () => {
        throw new Error("invalid json");
      },
      string: () => "not-json",
      respond: () => false,
    };
    expect(() => handlers.get("module.storage.*.changed")!(badMsg)).not.toThrow();
    await Promise.resolve();
    expect(webhook.send).not.toHaveBeenCalled();
  });
});
