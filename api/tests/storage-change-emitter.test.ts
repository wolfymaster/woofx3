import { describe, expect, it, mock } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Msg } from "@woofx3/nats/src/types";
import { mapStorageChanged, StorageChangeEmitter } from "../src/storage-change-emitter";

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

function envelope(data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    specversion: "1.0.0",
    type: "module.storage.changed",
    source: "barkloader",
    id: "ev-1",
    time: "2026-05-03T00:00:00.000Z",
    data,
    ...extra,
  };
}

const goodData = { moduleId: "counter", key: "counter:state:count", value: 7, occurredAt: "2026-05-03T00:00:00.500Z" };

describe("mapStorageChanged", () => {
  it("decodes a well-formed envelope", () => {
    expect(mapStorageChanged(envelope(goodData))).toEqual({
      type: EngineEventType.MODULE_STORAGE_CHANGED,
      ...goodData,
    });
  });

  it("accepts the session the publisher knew and a null value", () => {
    const event = mapStorageChanged(envelope({ ...goodData, value: null }, { sessionId: "s1", source: "api" }));
    expect(event?.value).toBeNull();
  });

  it.each([
    ["no occurredAt", { ...goodData, occurredAt: undefined }],
    ["no moduleId", { ...goodData, moduleId: undefined }],
    ["no key", { ...goodData, key: undefined }],
    ["no value", { ...goodData, value: undefined }],
    ["an unknown field", { ...goodData, previousValue: 1 }],
    ["a mistyped key", { ...goodData, key: 3 }],
  ])("refuses data with %s", (_name, data) => {
    expect(mapStorageChanged(envelope(data))).toBeNull();
  });

  it("refuses an envelope with another type or an unknown attribute", () => {
    expect(mapStorageChanged(envelope(goodData, { type: "module.storage.cleared" }))).toBeNull();
    expect(mapStorageChanged(envelope(goodData, { platform: "twitch" }))).toBeNull();
  });

  it("preserves the value verbatim: strings, objects, arrays", () => {
    expect(mapStorageChanged(envelope({ ...goodData, value: { nested: { count: 3 } } }))?.value).toEqual({
      nested: { count: 3 },
    });
    expect(mapStorageChanged(envelope({ ...goodData, value: ["a", "b", "c"] }))?.value).toEqual(["a", "b", "c"]);
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
    handlers.get("module.storage.*.changed")!(makeMsg("module.storage.counter.changed", envelope(goodData)));
    await Promise.resolve();
    expect(webhook.send).toHaveBeenCalledTimes(1);
    expect(webhook.send).toHaveBeenCalledWith({ type: EngineEventType.MODULE_STORAGE_CHANGED, ...goodData });
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
