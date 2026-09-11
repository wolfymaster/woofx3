import { describe, expect, it } from "bun:test";
import { parseSseChunk, SceneEventSource } from "../../public/scene-manager/event-source";
import type { ReconnectCoordinator } from "../../public/scene-manager/reconnect-coordinator";

describe("parseSseChunk", () => {
  it("parses a well-formed delivery frame", () => {
    const raw =
      'event: delivery\ndata: {"eventId":"e1","instanceId":"i1","type":"widget.event","key":"count","value":5}';
    expect(parseSseChunk(raw)).toEqual({
      kind: "delivery",
      frame: { eventId: "e1", instanceId: "i1", type: "widget.event", key: "count", value: 5 },
    });
  });

  it("parses a delivery frame with no event line", () => {
    const raw = 'data: {"eventId":"e1","instanceId":"i1","type":"widget.event","key":"count","value":5}';
    expect(parseSseChunk(raw)).toEqual({
      kind: "delivery",
      frame: { eventId: "e1", instanceId: "i1", type: "widget.event", key: "count", value: 5 },
    });
  });

  it("parses the hello control frame", () => {
    expect(parseSseChunk('event: hello\ndata: {"bootId":"boot-a"}')).toEqual({ kind: "hello", bootId: "boot-a" });
  });

  it("returns null for a hello frame with no bootId", () => {
    expect(parseSseChunk("event: hello\ndata: {}")).toBeNull();
  });

  it("returns null for a comment/keepalive line", () => {
    expect(parseSseChunk(": connected")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSseChunk("data: {not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseSseChunk('data: {"eventId":"e1"}')).toBeNull();
  });
});

function streamFromChunks(chunks: string[], leaveOpen = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (!leaveOpen) {
        controller.close();
      }
    },
  });
}

describe("SceneEventSource", () => {
  it("delivers frames as they arrive and reports connected on open", async () => {
    const frames: unknown[] = [];
    const connectionEvents: boolean[] = [];
    const body = streamFromChunks([
      'event: delivery\ndata: {"eventId":"e1","instanceId":"i1","type":"widget.event","key":"count","value":1}\n\n',
      'event: delivery\ndata: {"eventId":"e2","instanceId":"i1","type":"widget.event","key":"count","value":2}\n\n',
    ]);
    const fetchFn = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const source = new SceneEventSource({ url: "https://example.test/events", fetchFn });
    source.start({
      onFrame: (f) => frames.push(f),
      onConnectionChange: (c) => connectionEvents.push(c),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    // The fixture stream closes right after emitting both frames, which
    // is itself a disconnect the source correctly reports and reacts to
    // — the assertion here only cares that it connected first and
    // delivered both frames before that happened.
    expect(connectionEvents[0]).toBe(true);
    expect(frames).toEqual([
      { eventId: "e1", instanceId: "i1", type: "widget.event", key: "count", value: 1 },
      { eventId: "e2", instanceId: "i1", type: "widget.event", key: "count", value: 2 },
    ]);
    source.stop();
  });

  it("reports disconnected and schedules a reconnect on a non-OK response", async () => {
    let callCount = 0;
    const connectionEvents: boolean[] = [];
    const fetchFn = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(null, { status: 502 });
      }
      return new Response(streamFromChunks([]), { status: 200 });
    }) as unknown as typeof fetch;
    const source = new SceneEventSource({
      url: "https://example.test/events",
      fetchFn,
      reconnectBaseMs: 5,
      reconnectMaxMs: 20,
    });
    source.start({
      onFrame: () => {},
      onConnectionChange: (c) => connectionEvents.push(c),
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(connectionEvents[0]).toBe(false);
    expect(connectionEvents).toContain(true);
    source.stop();
  });

  it("reports disconnected when the fetch itself throws (network error)", async () => {
    const connectionEvents: boolean[] = [];
    const fetchFn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const source = new SceneEventSource({ url: "https://example.test/events", fetchFn, reconnectBaseMs: 1000 });
    source.start({
      onFrame: () => {},
      onConnectionChange: (c) => connectionEvents.push(c),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connectionEvents).toEqual([false]);
    source.stop();
  });

  it("calls the default fetch with a global receiver (browser Illegal-invocation regression)", async () => {
    // Chrome's WebIDL receiver check rejects `fetch` invoked with any
    // `this` other than the global, so storing the bare global on an
    // instance and calling `this.fetchFn(...)` throws "Illegal
    // invocation" — swallowed by connect()'s catch, leaving the scene
    // stuck on the Disconnected banner with no request ever sent. Bun's
    // fetch has no such check, so the guard is modeled explicitly here;
    // without the `.bind(globalThis)` in the constructor this fails.
    const original = globalThis.fetch;
    const receivers: unknown[] = [];
    globalThis.fetch = function (this: unknown) {
      receivers.push(this);
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response(streamFromChunks([]), { status: 200 }));
    } as unknown as typeof fetch;

    try {
      const connectionEvents: boolean[] = [];
      const source = new SceneEventSource({ url: "https://example.test/events", reconnectBaseMs: 1000 });
      source.start({
        onFrame: () => {},
        onConnectionChange: (c) => connectionEvents.push(c),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(receivers).toEqual([globalThis]);
      expect(connectionEvents[0]).toBe(true);
      source.stop();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("stop() prevents any further callbacks", async () => {
    const connectionEvents: boolean[] = [];
    const body = streamFromChunks([], true); // never closes on its own
    const fetchFn = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const source = new SceneEventSource({ url: "https://example.test/events", fetchFn });
    source.start({
      onFrame: () => {},
      onConnectionChange: (c) => connectionEvents.push(c),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connectionEvents).toEqual([true]);
    source.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connectionEvents).toEqual([true]);
  });

  it("surfaces the hello frame's bootId to the sink", async () => {
    const bootIds: string[] = [];
    const body = streamFromChunks(['event: hello\ndata: {"bootId":"boot-a"}\n\n'], true);
    const fetchFn = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const source = new SceneEventSource({ url: "https://example.test/events", fetchFn });
    source.start({
      onFrame: () => {},
      onConnectionChange: () => {},
      onHello: (bootId) => bootIds.push(bootId),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bootIds).toEqual(["boot-a"]);
    source.stop();
  });

  it("caps the backoff so a recovered server is never waited out for long", async () => {
    // The regression this guards: an uncapped (or minutes-capped)
    // backoff means a server that came back keeps showing a stale
    // Disconnected banner. Delays must plateau at reconnectMaxMs no
    // matter how many attempts have failed.
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof globalThis.setTimeout;

    try {
      const fetchFn = (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch;
      const source = new SceneEventSource({
        url: "https://example.test/events",
        fetchFn,
        reconnectBaseMs: 500,
        reconnectMaxMs: 5_000,
        random: () => 1,
      });
      source.start({ onFrame: () => {}, onConnectionChange: () => {} });
      await new Promise((resolve) => realSetTimeout(resolve, 30));
      source.stop();
      expect(delays.length).toBeGreaterThan(5);
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(5_000);
      }
      expect(delays[delays.length - 1]).toBe(5_000);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it("jitters the delay so overlays that dropped together do not retry in lockstep", async () => {
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof globalThis.setTimeout;

    try {
      const fetchFn = (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch;
      // Equal jitter: never below half the capped delay (so it can't
      // degenerate into a tight loop), never above it.
      const source = new SceneEventSource({
        url: "https://example.test/events",
        fetchFn,
        reconnectBaseMs: 1_000,
        reconnectMaxMs: 1_000,
        random: () => 0,
      });
      source.start({ onFrame: () => {}, onConnectionChange: () => {} });
      await new Promise((resolve) => realSetTimeout(resolve, 20));
      source.stop();
      expect(delays.every((d) => d === 500)).toBe(true);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it("skips its own probe when the coordinator elected another overlay", async () => {
    let fetchCount = 0;
    const fetchFn = (async () => {
      fetchCount += 1;
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    let probeAllowed = true;
    const coordinator: ReconnectCoordinator = {
      shouldProbe: () => probeAllowed,
      onDisconnected: () => {},
      onConnected: () => {},
      onPeerConnected: () => {},
      requestPeerReload: () => {},
      onPeerReload: () => {},
      stop: () => {},
    };

    const source = new SceneEventSource({
      url: "https://example.test/events",
      fetchFn,
      reconnectBaseMs: 2,
      reconnectMaxMs: 2,
      coordinator,
    });
    source.start({ onFrame: () => {}, onConnectionChange: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // First probe always runs; deny leadership and confirm no further
    // requests leave this instance while a sibling is the prober.
    probeAllowed = false;
    const countAfterFirst = fetchCount;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchCount).toBe(countAfterFirst);
    source.stop();
  });

  it("abandons its backoff and reconnects when a peer reports the server is up", async () => {
    let fetchCount = 0;
    const fetchFn = (async () => {
      fetchCount += 1;
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    let wake: (() => void) | null = null;
    const coordinator: ReconnectCoordinator = {
      shouldProbe: () => true,
      onDisconnected: () => {},
      onConnected: () => {},
      onPeerConnected: (handler) => {
        wake = handler;
      },
      requestPeerReload: () => {},
      onPeerReload: () => {},
      stop: () => {},
    };

    const source = new SceneEventSource({
      // A long backoff the wake-up has to visibly cut short.
      url: "https://example.test/events",
      fetchFn,
      reconnectBaseMs: 60_000,
      reconnectMaxMs: 60_000,
      coordinator,
    });
    source.start({ onFrame: () => {}, onConnectionChange: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchCount).toBe(1);

    wake!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchCount).toBe(2);
    source.stop();
  });
});
