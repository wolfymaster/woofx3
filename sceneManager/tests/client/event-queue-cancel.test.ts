import { describe, expect, it } from "bun:test";
import { EventQueueManager } from "../../public/scene-manager/event-queue";

function item(eventId: string) {
  return { eventId, type: "alert", key: eventId, value: null };
}

/** An alert widget's queue: one at a time, recording what played and what was stopped. */
function alertQueue() {
  const delivered: string[] = [];
  const stopped: string[] = [];
  const mgr = new EventQueueManager();
  mgr.register(
    "alert:inst-1",
    "inst-1",
    { maxInFlight: 1 },
    (i) => {
      delivered.push(i.eventId);
      return true;
    },
    () => {},
    (eventId) => stopped.push(eventId)
  );
  return { mgr, delivered, stopped };
}

describe("EventQueueManager.cancel", () => {
  it("stops the playing delivery and starts the next one", () => {
    const { mgr, delivered, stopped } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));

    mgr.cancel("inst-1", ["evt-1"]);

    expect(stopped).toEqual(["evt-1"]);
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });

  it("drops waiting deliveries and leaves the playing one alone", () => {
    const { mgr, delivered, stopped } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.enqueue("inst-1", item("evt-3"));

    mgr.cancel("inst-1", ["evt-2", "evt-3"]);
    expect(stopped).toEqual([]);

    mgr.complete("alert:inst-1", "evt-1");
    expect(delivered).toEqual(["evt-1"]);
  });

  // The cancel and the delivery are separate frames, and the server's sweep
  // may still have a re-push on the wire when it closes a delivery.
  it("ignores a cancelled delivery that arrives after the cancel", () => {
    const { mgr, delivered } = alertQueue();

    mgr.cancel("inst-1", ["evt-1"]);
    mgr.enqueue("inst-1", item("evt-1"));

    expect(delivered).toEqual([]);
  });

  it("ignores a late completion for a delivery it already stopped", () => {
    const { mgr, delivered } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.cancel("inst-1", ["evt-1"]);

    mgr.complete("alert:inst-1", "evt-1");
    mgr.enqueue("inst-1", item("evt-3"));

    // evt-2 is still playing; evt-3 waits behind it.
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });

  it("is a no-op for an instance with no queue", () => {
    const { mgr, stopped } = alertQueue();
    mgr.cancel("inst-unknown", ["evt-1"]);
    expect(stopped).toEqual([]);
  });
});
