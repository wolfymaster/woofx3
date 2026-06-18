import { describe, expect, it, mock } from "bun:test";
import {
  StorageBroadcaster,
  mapStorageChangedEnvelope,
  type StorageChangedPayload,
  type OverlayConnectionStore,
} from "../../src/storage/broadcaster";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

interface FakeOverlayWs {
  data: { token: string; applicationId: string; sceneId: string };
  sent: string[];
  send(data: string): void;
}

function fakeOverlayWs(applicationId: string, sceneId = "scene-1"): FakeOverlayWs {
  return {
    data: { token: "tok", applicationId, sceneId },
    sent: [],
    send(data: string) {
      this.sent.push(data);
    },
  };
}

function overlayStore(...wsList: FakeOverlayWs[]): OverlayConnectionStore {
  const store: OverlayConnectionStore = new Map();
  for (const ws of wsList) {
    const appId = ws.data.applicationId;
    let set = store.get(appId);
    if (!set) {
      set = new Set();
      store.set(appId, set);
    }
    set.add(ws as any);
  }
  return store;
}

// ─── mapStorageChangedEnvelope ───────────────────────────────────────────────

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
    expect(mapStorageChangedEnvelope({ data: { key: "k", value: 1 } })).toBeNull();
    expect(mapStorageChangedEnvelope({ data: { moduleId: "m", value: 1 } })).toBeNull();
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

// ─── StorageBroadcaster ──────────────────────────────────────────────────────

describe("StorageBroadcaster.broadcast", () => {
  it("sends a P2-wrapped storage frame to all overlay connections", () => {
    const ws1 = fakeOverlayWs("app-1");
    const ws2 = fakeOverlayWs("app-2");
    const b = new StorageBroadcaster(fakeLogger(), null, overlayStore(ws1, ws2));

    const payload: StorageChangedPayload = {
      moduleId: "counter",
      key: "counter:state:count",
      value: 4,
      occurredAt: "2026-05-03T00:00:00.000Z",
    };
    b.broadcast(payload);

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);

    const frame = JSON.parse(ws1.sent[0]!);
    expect(frame.proto).toBe("woofx3.overlay-events");
    expect(frame.v).toBe(1);
    expect(frame.frame.moduleId).toBe("counter");
    expect(frame.frame.key).toBe("counter:state:count");
    expect(frame.frame.value).toBe(4);
    expect(typeof frame.frame.id).toBe("string");
  });

  it("preserves a caller-supplied id", () => {
    const ws = fakeOverlayWs("app-1");
    const b = new StorageBroadcaster(fakeLogger(), null, overlayStore(ws));
    b.broadcast({ id: "stable-id", moduleId: "m", key: "k", value: 1, occurredAt: "t" });
    const frame = JSON.parse(ws.sent[0]!);
    expect(frame.frame.id).toBe("stable-id");
  });

  it("logs at debug and skips when no overlay connections exist", () => {
    const logger = fakeLogger();
    const b = new StorageBroadcaster(logger);
    b.broadcast({ moduleId: "m", key: "k", value: 1, occurredAt: "t" });
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("StorageBroadcaster.broadcastEvent", () => {
  it("sends a P2-wrapped event frame to all overlay connections", () => {
    const ws = fakeOverlayWs("app-1");
    const b = new StorageBroadcaster(fakeLogger(), null, overlayStore(ws));
    b.broadcastEvent({
      kind: "event",
      type: "twitch.follow",
      source: "twitch_platform",
      time: "2026-05-03T00:00:00.000Z",
      data: { username: "streamer" },
      parameters: { widget: "MediaAlert" },
    });

    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]!);
    expect(frame.proto).toBe("woofx3.overlay-events");
    expect(frame.frame.kind).toBe("event");
    expect(frame.frame.type).toBe("twitch.follow");
    expect(frame.frame.parameters).toEqual({ widget: "MediaAlert" });
  });
});

describe("StorageBroadcaster.overlayClientCount", () => {
  it("counts total sockets across all applicationIds", () => {
    const ws1 = fakeOverlayWs("app-1");
    const ws2 = fakeOverlayWs("app-1");
    const ws3 = fakeOverlayWs("app-2");
    const b = new StorageBroadcaster(fakeLogger(), null, overlayStore(ws1, ws2, ws3));
    expect(b.overlayClientCount()).toBe(3);
  });

  it("returns zero with an empty store", () => {
    const b = new StorageBroadcaster(fakeLogger());
    expect(b.overlayClientCount()).toBe(0);
  });
});

describe("StorageBroadcaster.pushSceneFrame", () => {
  it("sends only to connections matching the sceneId", () => {
    const ws1 = fakeOverlayWs("app-1", "scene-A");
    const ws2 = fakeOverlayWs("app-2", "scene-B");
    const b = new StorageBroadcaster(fakeLogger(), null, overlayStore(ws1, ws2));
    const frameJson = JSON.stringify({ proto: "woofx3.overlay-events", v: 1, frame: { kind: "scene.updated" } });
    b.pushSceneFrame("scene-A", frameJson);
    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(0);
  });
});
