import { describe, expect, it } from "bun:test";
import { parseSseChunk, SceneEventSource } from "../../public/scene-manager/event-source";

describe("parseSseChunk", () => {
  it("parses a well-formed data line", () => {
    const raw = 'event: delivery\ndata: {"eventId":"e1","instanceId":"i1","type":"widget.event","key":"count","value":5}';
    expect(parseSseChunk(raw)).toEqual({ eventId: "e1", instanceId: "i1", type: "widget.event", key: "count", value: 5 });
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
    const source = new SceneEventSource({ url: "https://example.test/events", fetchFn, reconnectBaseMs: 5, reconnectMaxMs: 20 });
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
});
