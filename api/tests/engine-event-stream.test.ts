import { describe, expect, mock, test } from "bun:test";
import type { EngineEventFrame } from "@woofx3/api";
import {
  type CallbackEnvelope,
  EngineEventType,
  EngineRequestType,
  makeCallbackEnvelope,
  makeRequestEnvelope,
} from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import {
  DEFAULT_ENGINE_EVENT_STREAM_LIMITS,
  EngineEventStream,
  type EngineEventStreamLimits,
} from "../src/engine-event-stream";

function fakeLogger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) };
}

function newStream(limits: Partial<EngineEventStreamLimits> = {}) {
  const logger = fakeLogger();
  const stream = new EngineEventStream(logger as unknown as SharedLogger, {
    ...DEFAULT_ENGINE_EVENT_STREAM_LIMITS,
    ...limits,
  });
  return { stream, logger };
}

/** A subscriber that records frames and, like a capnweb stub, reports when its session breaks. */
function collector() {
  const frames: EngineEventFrame[] = [];
  let broken: ((error: unknown) => void) | undefined;
  const subscriber = {
    onEngineEvent: mock(async (frame: EngineEventFrame) => {
      frames.push(frame);
    }),
    onRpcBroken(callback: (error: unknown) => void) {
      broken = callback;
    },
  };
  return { frames, subscriber, breakSession: () => broken?.(new Error("socket closed")) };
}

/** A subscriber whose every push waits until the test releases it. */
function stalled() {
  const frames: EngineEventFrame[] = [];
  const waiting: (() => void)[] = [];
  const subscriber = {
    onEngineEvent: (frame: EngineEventFrame) =>
      new Promise<void>((resolve) => {
        frames.push(frame);
        waiting.push(resolve);
      }),
  };
  const releaseAll = async () => {
    while (waiting.length > 0) {
      waiting.shift()?.();
      await settle();
    }
  };
  return { frames, subscriber, releaseAll };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function workflowDeleted(workflowId: string): CallbackEnvelope {
  return makeCallbackEnvelope({ type: EngineEventType.WORKFLOW_DELETED, workflowId });
}

function tokenRequest() {
  return makeRequestEnvelope({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED });
}

describe("EngineEventStream", () => {
  test("a subscription receives each envelope unchanged, in order, numbered from 1", async () => {
    const { stream } = newStream();
    const { frames, subscriber } = collector();
    stream.subscribe(subscriber, undefined, {}, "local");

    const first = workflowDeleted("w1");
    const second = workflowDeleted("w2");
    expect(stream.publish(first)).toBe(1);
    expect(stream.publish(second)).toBe(1);
    await settle();

    expect(frames).toEqual([
      { kind: "event", envelope: first, seq: 1 },
      { kind: "event", envelope: second, seq: 2 },
    ]);
  });

  test("an event for one client reaches only that client's subscriptions", async () => {
    const { stream } = newStream();
    const mine = collector();
    const theirs = collector();
    stream.subscribe(mine.subscriber, undefined, {}, "local");
    stream.subscribe(theirs.subscriber, undefined, {}, "other");

    expect(stream.publish(workflowDeleted("w1"), "local")).toBe(1);
    await settle();

    expect(mine.frames).toHaveLength(1);
    expect(theirs.frames).toHaveLength(0);
  });

  test("a subscription that names types gets only those events", async () => {
    const { stream } = newStream();
    const { frames, subscriber } = collector();
    stream.subscribe(subscriber, [EngineEventType.SCENE_DELETED], {}, "local");

    expect(stream.publish(workflowDeleted("w1"))).toBe(0);
    await settle();

    expect(frames).toHaveLength(0);
  });

  test("a second subscription on the same session replaces the first", async () => {
    const { stream } = newStream();
    const session = {};
    const first = collector();
    const second = collector();
    stream.subscribe(first.subscriber, undefined, session, "local");
    stream.subscribe(second.subscriber, undefined, session, "local");

    stream.publish(workflowDeleted("w1"));
    await settle();

    expect(stream.subscriberCount).toBe(1);
    expect(first.frames).toHaveLength(0);
    expect(second.frames).toHaveLength(1);
    // The replaced stub's session breaking later must not remove its replacement.
    first.breakSession();
    expect(stream.subscriberCount).toBe(1);
  });

  test("a subscription is dropped when its session breaks", () => {
    const { stream } = newStream();
    const { subscriber, breakSession } = collector();
    stream.subscribe(subscriber, undefined, {}, "local");
    expect(stream.clientIds()).toEqual(["local"]);

    breakSession();

    expect(stream.subscriberCount).toBe(0);
    expect(stream.clientIds()).toEqual([]);
    expect(stream.publish(workflowDeleted("w1"))).toBe(0);
  });

  test("keeps a capnweb stub past the subscribe call, and disposes it when dropped", () => {
    const { stream } = newStream();
    let broken: ((error: unknown) => void) | undefined;
    const held = {
      onEngineEvent: async () => {},
      onRpcBroken(callback: (error: unknown) => void) {
        broken = callback;
      },
      [Symbol.dispose]: mock(() => {}),
    };
    const stub = { onEngineEvent: async () => {}, dup: mock(() => held) };

    stream.subscribe(stub, undefined, {}, "local");
    expect(stub.dup).toHaveBeenCalledTimes(1);

    broken?.(new Error("socket closed"));
    expect(held[Symbol.dispose]).toHaveBeenCalledTimes(1);
  });

  test("a slow subscriber holds up neither the publisher nor anyone else, and loses its oldest frames", async () => {
    const { stream, logger } = newStream({ bufferLimit: 2 });
    const slow = stalled();
    const fast = collector();
    stream.subscribe(slow.subscriber, undefined, {}, "slow");
    stream.subscribe(fast.subscriber, undefined, {}, "fast");

    const envelopes = ["w1", "w2", "w3", "w4", "w5"].map(workflowDeleted);
    for (const envelope of envelopes) {
      // Synchronous: publishing never waits on a subscriber.
      expect(stream.publish(envelope)).toBe(2);
      await settle();
    }

    expect(fast.frames.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);
    // The first is in flight; the queue holds two, so w2 and w3 were dropped.
    await slow.releaseAll();
    expect(slow.frames.map((f) => f.seq)).toEqual([1, 4, 5]);
    expect(slow.frames.map((f) => f.envelope.id)).toEqual([envelopes[0].id, envelopes[3].id, envelopes[4].id]);
    // One warning for the episode, not one per dropped frame.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(stream.subscriberCount).toBe(2);
  });

  test("a push that rejects drops the subscription and logs why", async () => {
    const { stream, logger } = newStream();
    const subscriber = {
      onEngineEvent: mock(async () => {
        throw new Error("handler blew up");
      }),
    };
    stream.subscribe(subscriber, undefined, {}, "local");

    stream.publish(workflowDeleted("w1"));
    await settle();
    stream.publish(workflowDeleted("w2"));
    await settle();

    expect(subscriber.onEngineEvent).toHaveBeenCalledTimes(1);
    expect(stream.subscriberCount).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "EngineEventStream: subscription dropped",
      expect.objectContaining({ clientId: "local", reason: "push failed: handler blew up" })
    );
  });

  test("rejects a bufferLimit that is not a positive integer", () => {
    expect(() => newStream({ bufferLimit: 0 })).toThrow("bufferLimit");
  });

  test("rejects a pushTimeoutMs that is not a positive integer", () => {
    expect(() => newStream({ pushTimeoutMs: 0 })).toThrow("pushTimeoutMs");
  });

  test("a push that never settles drops the subscription after pushTimeoutMs", async () => {
    const { stream, logger } = newStream({ pushTimeoutMs: 20 });
    const slow = stalled();
    stream.subscribe(slow.subscriber, undefined, {}, "local");

    stream.publish(workflowDeleted("w1"));
    const answered = stream.request(tokenRequest(), "local", 60_000);

    await expect(answered).rejects.toThrow("the event stream subscription closed (push timed out after 20ms)");
    expect(stream.subscriberCount).toBe(0);
    expect(slow.frames).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "EngineEventStream: subscription dropped",
      expect.objectContaining({ clientId: "local", reason: "push timed out after 20ms" })
    );
  });

  test("dropClient drops every subscription of that client alone", async () => {
    const { stream } = newStream();
    const first = collector();
    const second = collector();
    const other = collector();
    stream.subscribe(first.subscriber, undefined, {}, "gone");
    stream.subscribe(second.subscriber, undefined, {}, "gone");
    stream.subscribe(other.subscriber, undefined, {}, "kept");
    const answered = stream.request(tokenRequest(), "gone", 60_000);

    stream.dropClient("gone");

    await expect(answered).rejects.toThrow("the event stream subscription closed (client deleted)");
    expect(stream.clientIds()).toEqual(["kept"]);
    expect(stream.hasSubscriber("gone")).toBe(false);
    expect(stream.publish(workflowDeleted("w1"))).toBe(1);
    await settle();
    expect(first.frames.filter((f) => f.kind === "event")).toHaveLength(0);
    expect(second.frames.filter((f) => f.kind === "event")).toHaveLength(0);
    expect(other.frames).toHaveLength(1);
  });
});

describe("EngineEventStream.stop", () => {
  test("fails requests in flight, releases every held stub, and ends a push in flight", async () => {
    const { stream } = newStream();
    const dispose = mock(() => {});
    const slow = stalled();
    const held = { ...slow.subscriber, [Symbol.dispose]: dispose };
    const stub = { onEngineEvent: async () => {}, dup: () => held };
    stream.subscribe(stub, undefined, {}, "local");
    stream.subscribe(collector().subscriber, undefined, {}, "other");
    stream.publish(workflowDeleted("in flight"));
    const answered = stream.request(tokenRequest(), "other", 60_000);

    stream.stop();

    await expect(answered).rejects.toThrow("the event stream subscription closed (engine shutting down)");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(stream.subscriberCount).toBe(0);
    expect(stream.clientIds()).toEqual([]);
    expect(stream.publish(workflowDeleted("after"))).toBe(0);
    await slow.releaseAll();
    expect(slow.frames).toHaveLength(1);
  });

  test("refuses new subscriptions and requests, and is idempotent", async () => {
    const { stream } = newStream();
    stream.stop();
    stream.stop();

    expect(() => stream.subscribe(collector().subscriber, undefined, {}, "local")).toThrow(
      "The engine event stream has stopped"
    );
    await expect(stream.request(tokenRequest(), "local", 1_000)).rejects.toThrow(
      "twitch.token.requested: the engine event stream has stopped"
    );
  });
});

describe("EngineEventStream requests", () => {
  test("a request is pushed with its envelope and resolves with the client's answer", async () => {
    const { stream } = newStream();
    const { frames, subscriber } = collector();
    stream.subscribe(subscriber, [EngineEventType.SCENE_DELETED], {}, "local");
    const envelope = tokenRequest();

    const answered = stream.request(envelope, "local", 1_000);
    await settle();
    // Pushed even though the subscription names other types.
    expect(frames).toEqual([{ kind: "request", envelope, seq: 1 }]);

    stream.answer("local", envelope.id, { ok: true, body: { token: null, reason: "not_linked" } });
    expect(await answered).toEqual({ token: null, reason: "not_linked" });
  });

  test("goes to the client's newest subscription only", async () => {
    const { stream } = newStream();
    const older = collector();
    const newer = collector();
    stream.subscribe(older.subscriber, undefined, {}, "local");
    stream.subscribe(newer.subscriber, undefined, {}, "local");

    const envelope = tokenRequest();
    const answered = stream.request(envelope, "local", 1_000);
    await settle();
    stream.answer("local", envelope.id, { ok: true, body: "ok" });
    await answered;

    expect(older.frames).toHaveLength(0);
    expect(newer.frames).toHaveLength(1);
  });

  test("a refusal rejects with the client's reason", async () => {
    const { stream } = newStream();
    stream.subscribe(collector().subscriber, undefined, {}, "local");
    const envelope = tokenRequest();

    const answered = stream.request(envelope, "local", 1_000);
    stream.answer("local", envelope.id, { ok: false, error: "not signed in" });

    await expect(answered).rejects.toThrow("twitch.token.requested: the client refused: not signed in");
  });

  test("rejects when no answer comes in time, and refuses the late answer", async () => {
    const { stream } = newStream();
    stream.subscribe(collector().subscriber, undefined, {}, "local");
    const envelope = tokenRequest();

    await expect(stream.request(envelope, "local", 10)).rejects.toThrow("no answer on the event stream within 10ms");
    expect(() => stream.answer("local", envelope.id, { ok: true, body: null })).toThrow("is waiting for this client");
  });

  test("another client cannot answer it", async () => {
    const { stream } = newStream();
    stream.subscribe(collector().subscriber, undefined, {}, "local");
    stream.subscribe(collector().subscriber, undefined, {}, "intruder");
    const envelope = tokenRequest();

    const answered = stream.request(envelope, "local", 1_000);
    expect(() => stream.answer("intruder", envelope.id, { ok: true, body: "forged" })).toThrow(
      "is waiting for this client"
    );
    stream.answer("local", envelope.id, { ok: true, body: "genuine" });

    expect(await answered).toBe("genuine");
  });

  test("rejects at once when the subscription's session breaks", async () => {
    const { stream } = newStream();
    const { subscriber, breakSession } = collector();
    stream.subscribe(subscriber, undefined, {}, "local");

    const answered = stream.request(tokenRequest(), "local", 60_000);
    breakSession();

    await expect(answered).rejects.toThrow("the event stream subscription closed (session closed)");
  });

  test("rejects at once when the request is dropped unsent behind a slow subscriber", async () => {
    const { stream } = newStream({ bufferLimit: 1 });
    const slow = stalled();
    stream.subscribe(slow.subscriber, undefined, {}, "local");
    stream.publish(workflowDeleted("in flight"));

    const answered = stream.request(tokenRequest(), "local", 60_000);
    stream.publish(workflowDeleted("pushes the request out"));

    await expect(answered).rejects.toThrow("dropped unsent, the client fell behind");
    await slow.releaseAll();
  });

  test("rejects when the client has no subscription", async () => {
    const { stream } = newStream();
    await expect(stream.request(tokenRequest(), "local", 1_000)).rejects.toThrow(
      "no engine event stream subscription for client id local"
    );
  });
});
