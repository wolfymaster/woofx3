import { describe, expect, it, mock } from "bun:test";
import {
  StorageBroadcaster,
  mapStorageChangedEnvelope,
  type StorageChangedPayload,
} from "./storage-broadcaster";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

interface FakeWs {
  data: { kind: "module-state"; id: string };
  sent: string[];
  send: (data: string) => void;
}

function fakeWs(id: string): FakeWs {
  const ws: FakeWs = {
    data: { kind: "module-state", id },
    sent: [] as string[],
    send: function (data: string) {
      this.sent.push(data);
    },
  };
  return ws;
}

describe("mapStorageChangedEnvelope", () => {
  it("decodes a well-formed envelope", () => {
    const payload = mapStorageChangedEnvelope({
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
    expect(payload).toEqual({
      moduleId: "counter",
      key: "counter:state:count",
      value: 7,
      occurredAt: "2026-05-03T00:00:00.500Z",
    });
  });

  it("falls back to envelope time when occurredAt is missing", () => {
    const payload = mapStorageChangedEnvelope({
      type: "module.storage.changed",
      time: "2026-05-03T00:00:00.000Z",
      data: { moduleId: "m", key: "k", value: null },
    });
    expect(payload?.occurredAt).toBe("2026-05-03T00:00:00.000Z");
  });

  it("returns null when moduleId or key is missing", () => {
    expect(
      mapStorageChangedEnvelope({ data: { key: "k", value: 1 } })
    ).toBeNull();
    expect(
      mapStorageChangedEnvelope({ data: { moduleId: "m", value: 1 } })
    ).toBeNull();
  });

  it("returns null on non-object input", () => {
    expect(mapStorageChangedEnvelope(null)).toBeNull();
    expect(mapStorageChangedEnvelope("hello")).toBeNull();
    expect(mapStorageChangedEnvelope(42)).toBeNull();
  });

  it("includes previousValue only when provided", () => {
    const withPrev = mapStorageChangedEnvelope({
      data: { moduleId: "m", key: "k", value: 2, previousValue: 1 },
    });
    expect(withPrev?.previousValue).toBe(1);

    const withoutPrev = mapStorageChangedEnvelope({
      data: { moduleId: "m", key: "k", value: 2 },
    });
    expect(withoutPrev && "previousValue" in withoutPrev).toBe(false);
  });
});

describe("StorageBroadcaster", () => {
  it("starts with zero clients", () => {
    const b = new StorageBroadcaster(fakeLogger());
    expect(b.clientCount()).toBe(0);
  });

  it("tracks open / close to update clientCount", () => {
    const b = new StorageBroadcaster(fakeLogger());
    const handlers = b.handlers();
    const ws1 = fakeWs("a") as any;
    const ws2 = fakeWs("b") as any;

    handlers.open!(ws1);
    handlers.open!(ws2);
    expect(b.clientCount()).toBe(2);

    handlers.close!(ws1, 1000, "bye");
    expect(b.clientCount()).toBe(1);

    handlers.close!(ws2, 1000, "bye");
    expect(b.clientCount()).toBe(0);
  });

  it("broadcast() fans out to every connected client and assigns an id", () => {
    const b = new StorageBroadcaster(fakeLogger());
    const handlers = b.handlers();
    const ws1 = fakeWs("a");
    const ws2 = fakeWs("b");
    handlers.open!(ws1 as any);
    handlers.open!(ws2 as any);

    const payload: StorageChangedPayload = {
      moduleId: "counter",
      key: "counter:state:count",
      value: 4,
      occurredAt: "2026-05-03T00:00:00.000Z",
    };
    b.broadcast(payload);

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);
    const decoded = JSON.parse(ws1.sent[0]);
    expect(decoded.moduleId).toBe("counter");
    expect(decoded.key).toBe("counter:state:count");
    expect(decoded.value).toBe(4);
    expect(typeof decoded.id).toBe("string");
    expect(decoded.id.length).toBeGreaterThan(0);
  });

  it("preserves a caller-supplied id (no overwrite)", () => {
    const b = new StorageBroadcaster(fakeLogger());
    const handlers = b.handlers();
    const ws = fakeWs("a");
    handlers.open!(ws as any);

    b.broadcast({
      id: "stable-id",
      moduleId: "m",
      key: "k",
      value: 1,
      occurredAt: "2026-05-03T00:00:00.000Z",
    });
    const decoded = JSON.parse(ws.sent[0]);
    expect(decoded.id).toBe("stable-id");
  });

  it("logs and skips when no clients are connected", () => {
    const logger = fakeLogger();
    const b = new StorageBroadcaster(logger);
    b.broadcast({
      moduleId: "m",
      key: "k",
      value: 1,
      occurredAt: "2026-05-03T00:00:00.000Z",
    });
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("nextConnectionData stamps the kind discriminator", () => {
    const b = new StorageBroadcaster(fakeLogger());
    const data = b.nextConnectionData();
    expect(data.kind).toBe("module-state");
    expect(data.id).toMatch(/^module-state-\d+$/);
  });
});

function fakeNats() {
  const published: Array<{ subject: string; payload: unknown }> = [];
  const client: any = {
    published,
    publish: mock((subject: string, data: Uint8Array) => {
      published.push({ subject, payload: JSON.parse(new TextDecoder().decode(data)) });
      return Promise.resolve();
    }),
  };
  return client;
}

describe("StorageBroadcaster widget.event inbound", () => {
  it("forwards a valid widget.event to NATS widget.event", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const b = new StorageBroadcaster(logger, nats);
    const handlers = b.handlers();
    const ws = fakeWs("client-1") as any;
    handlers.open?.(ws);
    handlers.message?.(
      ws,
      JSON.stringify({
        kind: "widget.event",
        moduleId: "counter",
        instanceId: "inst-1",
        widgetCanonicalId: "counter:widget:raid_counter",
        key: "count",
        value: 42,
      })
    );
    expect(nats.published).toHaveLength(1);
    const env = nats.published[0]!;
    expect(env.subject).toBe("widget.event");
    expect((env.payload as any).type).toBe("widget.event");
    expect((env.payload as any).data.moduleId).toBe("counter");
    expect((env.payload as any).data.instanceId).toBe("inst-1");
    expect((env.payload as any).data.key).toBe("count");
    expect((env.payload as any).data.value).toBe(42);
    expect(typeof (env.payload as any).data.occurredAt).toBe("string");
  });

  it("drops widget.event without moduleId / instanceId / key", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const b = new StorageBroadcaster(logger, nats);
    const handlers = b.handlers();
    const ws = fakeWs("client-1") as any;
    handlers.open?.(ws);
    handlers.message?.(
      ws,
      JSON.stringify({ kind: "widget.event", moduleId: "counter", key: "count" })
    );
    expect(nats.published).toHaveLength(0);
  });

  it("ignores messages with unknown kind", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const b = new StorageBroadcaster(logger, nats);
    const handlers = b.handlers();
    const ws = fakeWs("client-1") as any;
    handlers.open?.(ws);
    handlers.message?.(ws, JSON.stringify({ kind: "garbage" }));
    expect(nats.published).toHaveLength(0);
  });

  it("survives malformed JSON without throwing", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const b = new StorageBroadcaster(logger, nats);
    const handlers = b.handlers();
    const ws = fakeWs("client-1") as any;
    handlers.open?.(ws);
    expect(() => handlers.message?.(ws, "not json")).not.toThrow();
    expect(nats.published).toHaveLength(0);
  });

  it("logs and drops when NATS is unavailable", () => {
    const logger = fakeLogger();
    const b = new StorageBroadcaster(logger, null);
    const handlers = b.handlers();
    const ws = fakeWs("client-1") as any;
    handlers.open?.(ws);
    handlers.message?.(
      ws,
      JSON.stringify({
        kind: "widget.event",
        moduleId: "counter",
        instanceId: "inst-1",
        key: "count",
        value: 1,
      })
    );
    expect(logger.warn).toHaveBeenCalled();
  });
});
