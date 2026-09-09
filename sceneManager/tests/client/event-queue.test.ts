import { describe, expect, it, mock } from "bun:test";
import { EventQueueManager, toWidgetEvent } from "../../public/scene-manager/event-queue";

function item(eventId: string, value: unknown = null) {
  return { eventId, type: "widget.event", key: "count", value };
}

describe("EventQueueManager — maxInFlight backpressure", () => {
  it("holds items in queue until an in-flight completion frees a slot (maxInFlight: 1)", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1 },
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );

    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.enqueue("inst-1", item("evt-3"));
    // Only the first is dispatched — the other two wait behind maxInFlight: 1.
    expect(delivered).toEqual(["evt-1"]);

    mgr.complete("sub-1", "evt-1");
    expect(delivered).toEqual(["evt-1", "evt-2"]);

    mgr.complete("sub-1", "evt-2");
    expect(delivered).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("dispatches up to maxInFlight items concurrently", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 2 },
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.enqueue("inst-1", item("evt-3"));
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });

  it("defaults to maxInFlight: 1 when omitted", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      {},
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    expect(delivered).toEqual(["evt-1"]);
  });
});

describe("EventQueueManager — priorityExpr ordering", () => {
  it("dispatches higher-priority queued items first once a slot frees up", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1, priorityExpr: "value.amount" },
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );

    mgr.enqueue("inst-1", item("evt-low", { amount: 1 })); // dispatched immediately (slot free)
    mgr.enqueue("inst-1", item("evt-mid", { amount: 5 }));
    mgr.enqueue("inst-1", item("evt-high", { amount: 10 }));
    expect(delivered).toEqual(["evt-low"]);

    mgr.complete("sub-1", "evt-low");
    // Of the two queued, the higher amount goes first.
    expect(delivered).toEqual(["evt-low", "evt-high"]);

    mgr.complete("sub-1", "evt-high");
    expect(delivered).toEqual(["evt-low", "evt-high", "evt-mid"]);
  });

  it("treats a non-numeric or throwing expression result as priority 0 (FIFO fallback)", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1, priorityExpr: "value.missing.deeper" },
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.enqueue("inst-1", item("evt-1", {}));
    mgr.enqueue("inst-1", item("evt-2", {}));
    mgr.complete("sub-1", "evt-1");
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });
});

describe("EventQueueManager — retryTimeoutMs", () => {
  it("advances the queue if completion never arrives within the timeout", async () => {
    const delivered: string[] = [];
    const timedOut: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1, retryTimeoutMs: 10 },
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      (eventId) => timedOut.push(eventId)
    );
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    expect(delivered).toEqual(["evt-1"]);

    // Wait past evt-1's timeout, but complete evt-2 immediately once it's
    // dispatched so only evt-1 ever times out.
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(delivered).toEqual(["evt-1", "evt-2"]);
    mgr.complete("sub-1", "evt-2");
    expect(timedOut).toEqual(["evt-1"]);
  });

  it("a late completion after timeout is a harmless no-op", async () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1, retryTimeoutMs: 10 },
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.enqueue("inst-1", item("evt-1"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(() => mgr.complete("sub-1", "evt-1")).not.toThrow();
  });

  it("never times out when retryTimeoutMs is omitted", async () => {
    const timedOut: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1 },
      () => true,
      (eventId) => timedOut.push(eventId)
    );
    mgr.enqueue("inst-1", item("evt-1"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(timedOut).toEqual([]);
  });
});

describe("EventQueueManager — routing and lifecycle", () => {
  it("enqueue on an unregistered instance returns false and drops the item", () => {
    const mgr = new EventQueueManager();
    expect(mgr.enqueue("no-such-instance", item("evt-1"))).toBe(false);
  });

  it("complete() routes by the shim-assigned subId, not instanceId", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-a",
      "inst-a",
      { maxInFlight: 1 },
      (i) => {
        delivered.push(`a:${i.eventId}`);
        return true;
      },
      () => {}
    );
    mgr.register(
      "sub-b",
      "inst-b",
      { maxInFlight: 1 },
      (i) => {
        delivered.push(`b:${i.eventId}`);
        return true;
      },
      () => {}
    );
    mgr.enqueue("inst-a", item("evt-1"));
    mgr.enqueue("inst-a", item("evt-2"));
    expect(delivered).toEqual(["a:evt-1"]);
    mgr.complete("sub-a", "evt-1");
    expect(delivered).toEqual(["a:evt-1", "a:evt-2"]);
    // A stray complete() for the wrong instance's sub does nothing to inst-a's queue.
    mgr.complete("sub-b", "evt-2");
    expect(delivered).toEqual(["a:evt-1", "a:evt-2"]);
  });

  it("unregister drops the instance's queue", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    mgr.register(
      "sub-1",
      "inst-1",
      {},
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.unregister("sub-1");
    expect(mgr.enqueue("inst-1", item("evt-1"))).toBe(false);
  });

  it("deliver() returning false (subscription gone) drops the item without holding a slot", () => {
    const mgr = new EventQueueManager();
    const attempts: string[] = [];
    mgr.register(
      "sub-1",
      "inst-1",
      { maxInFlight: 1 },
      (i) => {
        attempts.push(i.eventId);
        return false;
      },
      () => {}
    );
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    // Both attempted immediately since a failed deliver() never occupies a slot.
    expect(attempts).toEqual(["evt-1", "evt-2"]);
  });
});


describe("toWidgetEvent", () => {
  const frame = { eventId: "e1", type: "channel.follow", key: "channel.follow" };

  it("lifts parameters to the top level where the SDK and widgets read them", () => {
    // media_alert reads event.parameters for text/media/audio/duration;
    // leaving them nested under data renders a blank alert.
    const event = toWidgetEvent({ ...frame, value: { userName: "someone", parameters: { text: "hi", duration: 3 } } });
    expect(event.parameters).toEqual({ text: "hi", duration: 3 });
    expect(event.data).toEqual({ userName: "someone" });
    expect(event.type).toBe("channel.follow");
    expect(event.eventId).toBe("e1");
  });

  it("omits parameters entirely when the delivery carries none", () => {
    const event = toWidgetEvent({ ...frame, value: { userName: "someone" } });
    expect(event.parameters).toBeUndefined();
    expect(event.data).toEqual({ userName: "someone" });
  });

  it("ignores a non-object parameters value rather than forwarding junk", () => {
    const event = toWidgetEvent({ ...frame, value: { userName: "someone", parameters: "nope" } });
    expect(event.parameters).toBeUndefined();
  });

  it("passes a non-object value through as data untouched", () => {
    expect(toWidgetEvent({ ...frame, value: 42 }).data).toBe(42);
    expect(toWidgetEvent({ ...frame, value: null }).data).toBeNull();
  });
});
