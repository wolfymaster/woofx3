import { describe, expect, it } from "bun:test";
import { AckBatcher, postAck } from "../../public/scene-manager/ack-batcher";

interface Call {
  url: string;
  instanceIds: string[];
}

function recorder(): { calls: Call[]; fetchFn: typeof fetch } {
  const calls: Call[] = [];
  const fetchFn = (async (url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as { instanceIds: string[] };
    calls.push({ url: String(url), instanceIds: body.instanceIds });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const endpoint = (eventId: string) => `/scene/s1/events/${eventId}/completed`;

describe("AckBatcher", () => {
  it("actually posts the batch it accumulated", async () => {
    // Regression: flush() used to hold `this.pending` itself rather than
    // a snapshot, so clear() emptied the batch before the post loop ran
    // and no ack ever left the page — every delivery stayed open and got
    // redelivered forever.
    const { calls, fetchFn } = recorder();
    const batcher = new AckBatcher(endpoint, { windowMs: 1, fetchFn });
    batcher.add("e1", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([{ url: "/scene/s1/events/e1/completed", instanceIds: ["w-1"] }]);
  });

  it("groups instances of one event into a single post", async () => {
    const { calls, fetchFn } = recorder();
    const batcher = new AckBatcher(endpoint, { windowMs: 1, fetchFn });
    batcher.add("e1", "w-1");
    batcher.add("e1", "w-2");
    batcher.add("e1", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.instanceIds.sort()).toEqual(["w-1", "w-2"]);
  });

  it("posts one request per distinct event", async () => {
    const { calls, fetchFn } = recorder();
    const batcher = new AckBatcher(endpoint, { windowMs: 1, fetchFn });
    batcher.add("e1", "w-1");
    batcher.add("e2", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.map((c) => c.url).sort()).toEqual(["/scene/s1/events/e1/completed", "/scene/s1/events/e2/completed"]);
  });

  it("starts a fresh window after a flush instead of going inert", async () => {
    const { calls, fetchFn } = recorder();
    const batcher = new AckBatcher(endpoint, { windowMs: 1, fetchFn });
    batcher.add("e1", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    batcher.add("e2", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
  });

  it("does not re-post an already flushed batch", async () => {
    const { calls, fetchFn } = recorder();
    const batcher = new AckBatcher(endpoint, { windowMs: 1, fetchFn });
    batcher.add("e1", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
  });
});

describe("acks the server did not take", () => {
  const fast = { initialMs: 1, maxMs: 2, attempts: 3 };

  function answering(...statuses: Array<number | "network">) {
    const calls: string[] = [];
    const fetchFn = (async (url: unknown) => {
      calls.push(String(url));
      const next = statuses.shift() ?? 200;
      if (next === "network") {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      }
      return new Response(null, { status: next });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("sends a batch again after the server fails it, until it is taken", async () => {
    const { calls, fetchFn } = answering(503, 200);
    const batcher = new AckBatcher(endpoint, { windowMs: 1, fetchFn, retry: fast });
    batcher.add("e1", "w-1");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toEqual(["/scene/s1/events/e1/completed", "/scene/s1/events/e1/completed"]);
  });

  it("sends again after a network failure or an expired session", async () => {
    const { calls, fetchFn } = answering("network", 401, 200);
    postAck(fetchFn, "/ack", ["w-1"], fast);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toHaveLength(3);
  });

  it("does not resend an ack the server refused as malformed", async () => {
    const { calls, fetchFn } = answering(400);
    postAck(fetchFn, "/ack", ["w-1"], fast);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toHaveLength(1);
  });

  it("gives up after its attempts", async () => {
    const { calls, fetchFn } = answering(503, 503, 503, 503, 503);
    postAck(fetchFn, "/ack", ["w-1"], fast);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(3);
  });
});
