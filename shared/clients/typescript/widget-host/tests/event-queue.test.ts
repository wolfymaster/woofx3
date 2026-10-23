import { describe, expect, it, mock } from "bun:test";
import { EventQueueManager, toWidgetEvent } from "../page/event-queue";

function item(eventId: string, value: unknown = null) {
  return { eventId, type: "widget.event", key: "count", value };
}

describe("EventQueueManager — maxInFlight backpressure", () => {
  it("holds items in queue until an in-flight completion frees a slot (maxInFlight: 1)", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
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

    mgr.complete(registration, "evt-1");
    expect(delivered).toEqual(["evt-1", "evt-2"]);

    mgr.complete(registration, "evt-2");
    expect(delivered).toEqual(["evt-1", "evt-2", "evt-3"]);
  });

  it("dispatches up to maxInFlight items concurrently", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
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
    const registration = mgr.register(
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
    const registration = mgr.register(
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

    mgr.complete(registration, "evt-low");
    // Of the two queued, the higher amount goes first.
    expect(delivered).toEqual(["evt-low", "evt-high"]);

    mgr.complete(registration, "evt-high");
    expect(delivered).toEqual(["evt-low", "evt-high", "evt-mid"]);
  });

  it("treats a non-numeric or throwing expression result as priority 0 (FIFO fallback)", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
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
    mgr.complete(registration, "evt-1");
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });
});

describe("EventQueueManager — retryTimeoutMs", () => {
  it("advances the queue if completion never arrives within the timeout", async () => {
    const delivered: string[] = [];
    const timedOut: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
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
    mgr.complete(registration, "evt-2");
    expect(timedOut).toEqual(["evt-1"]);
  });

  it("a late completion after timeout is a harmless no-op", async () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
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
    expect(() => mgr.complete(registration, "evt-1")).not.toThrow();
  });

  it("never times out when retryTimeoutMs is omitted", async () => {
    const timedOut: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
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
    const registrationA = mgr.register(
      "inst-a",
      { maxInFlight: 1 },
      (i) => {
        delivered.push(`a:${i.eventId}`);
        return true;
      },
      () => {}
    );
    const registrationB = mgr.register(
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
    mgr.complete(registrationA, "evt-1");
    expect(delivered).toEqual(["a:evt-1", "a:evt-2"]);
    // A stray complete() for the wrong instance's sub does nothing to inst-a's queue.
    mgr.complete(registrationB, "evt-2");
    expect(delivered).toEqual(["a:evt-1", "a:evt-2"]);
  });

  it("unregister drops the instance's queue", () => {
    const delivered: string[] = [];
    const mgr = new EventQueueManager();
    const registration = mgr.register(
      "inst-1",
      {},
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.unregister(registration);
    expect(mgr.enqueue("inst-1", item("evt-1"))).toBe(false);
  });

  it("deliver() returning false (subscription gone) drops the item without holding a slot", () => {
    const mgr = new EventQueueManager();
    const attempts: string[] = [];
    const registration = mgr.register(
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

describe("EventQueueManager.pending", () => {
  it("lists what is waiting, next first, without what is in flight, finished or cancelled", () => {
    const mgr = new EventQueueManager();
    const registration = mgr.register("inst-1", { maxInFlight: 1, priorityExpr: "value" }, () => true, () => {});
    mgr.enqueue("inst-1", item("evt-1", 1));
    mgr.enqueue("inst-1", item("evt-2", 1));
    mgr.enqueue("inst-1", item("evt-3", 5));
    mgr.enqueue("inst-1", item("evt-4", 1));

    expect(mgr.pending(registration).map((i) => i.eventId)).toEqual(["evt-3", "evt-2", "evt-4"]);

    mgr.cancel("inst-1", ["evt-2"]);
    mgr.complete(registration, "evt-1");

    expect(mgr.pending(registration)).toEqual([item("evt-4", 1)]);
  });

  it("is empty for a queue another has replaced, which took over what was waiting", () => {
    const mgr = new EventQueueManager();
    const old = mgr.register("inst-1", { maxInFlight: 1 }, () => true, () => {});
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.enqueue("inst-1", item("evt-3"));

    const current = mgr.register("inst-1", { maxInFlight: 1 }, () => true, () => {});

    expect(mgr.pending(old)).toEqual([]);
    expect(mgr.pending(current)).toEqual([item("evt-3")]);
  });
});

describe("toWidgetEvent", () => {
  const frame = { eventId: "e1", type: "channel.follow", key: "channel.follow" };

  it("carries the delivery's type, id and value, stamped with the time given", () => {
    const event = toWidgetEvent({ ...frame, value: { userName: "someone" } }, Date.UTC(2026, 9, 18, 12));
    expect(event.type).toBe("channel.follow");
    expect(event.eventId).toBe("e1");
    expect(event.data).toEqual({ userName: "someone" });
    expect(event.time).toBe("2026-10-18T12:00:00.000Z");
  });

  it("passes a non-object value through as data untouched", () => {
    expect(toWidgetEvent({ ...frame, value: 42 }, 0).data).toBe(42);
    expect(toWidgetEvent({ ...frame, value: null }, 0).data).toBeNull();
  });
});

describe("EventQueueManager — a frame swapped in for another", () => {
  function frame(mgr: EventQueueManager, config = { maxInFlight: 1 }) {
    const delivered: string[] = [];
    const timedOut: string[] = [];
    const registration = mgr.register(
      "inst-1",
      config,
      (i) => {
        delivered.push(i.eventId);
        return true;
      },
      (eventId) => timedOut.push(eventId)
    );
    return { registration, delivered, timedOut };
  }

  it("keeps sending the placement's events to the new frame after the old one is retired", () => {
    const mgr = new EventQueueManager();
    const old = frame(mgr);
    const fresh = frame(mgr);

    mgr.unregister(old.registration);

    expect(mgr.enqueue("inst-1", item("evt-1"))).toBe(true);
    expect(fresh.delivered).toEqual(["evt-1"]);
    expect(old.delivered).toEqual([]);
  });

  it("lets the old frame finish what it is showing, and hands the new one what was waiting", () => {
    const mgr = new EventQueueManager();
    const old = frame(mgr);
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));

    const fresh = frame(mgr);
    mgr.complete(old.registration, "evt-1");
    mgr.unregister(old.registration);

    expect(old.delivered).toEqual(["evt-1"]);
    expect(fresh.delivered).toEqual(["evt-2"]);
  });

  it("hands the new frame what the old one never finished", () => {
    const mgr = new EventQueueManager();
    const old = frame(mgr);
    mgr.enqueue("inst-1", item("evt-1"));

    const fresh = frame(mgr);
    mgr.unregister(old.registration);

    expect(fresh.delivered).toEqual(["evt-1"]);
  });

  it("does not replay to the new frame what the old one finished", () => {
    const mgr = new EventQueueManager();
    const old = frame(mgr);
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.complete(old.registration, "evt-1");

    const fresh = frame(mgr);
    mgr.unregister(old.registration);
    mgr.enqueue("inst-1", item("evt-1"));

    expect(fresh.delivered).toEqual([]);
  });

  it("stops a retired queue's timers", async () => {
    const mgr = new EventQueueManager();
    const only = frame(mgr, { maxInFlight: 1, retryTimeoutMs: 5 } as never);
    mgr.enqueue("inst-1", item("evt-1"));

    mgr.unregister(only.registration);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(only.timedOut).toEqual([]);
  });

  it("refuses an event for an instance with no queue, so it is not acknowledged", () => {
    const mgr = new EventQueueManager();
    expect(mgr.enqueue("inst-1", item("evt-1"))).toBe(false);
  });
});
