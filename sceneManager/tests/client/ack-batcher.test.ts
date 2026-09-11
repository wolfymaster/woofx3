import { describe, expect, it } from "bun:test";
import { AckBatcher } from "../../public/scene-manager/ack-batcher";

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
