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
  const registration = mgr.register(
    "inst-1",
    { maxInFlight: 1 },
    (i) => {
      delivered.push(i.eventId);
      return true;
    },
    () => {},
    (eventId) => stopped.push(eventId)
  );
  return { mgr, delivered, stopped, registration };
}

describe("EventQueueManager.cancel", () => {
  it("stops the playing delivery and starts the next one", () => {
    const { mgr, delivered, stopped, registration } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));

    mgr.cancel("inst-1", ["evt-1"]);

    expect(stopped).toEqual(["evt-1"]);
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });

  it("drops waiting deliveries and leaves the playing one alone", () => {
    const { mgr, delivered, stopped, registration } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.enqueue("inst-1", item("evt-3"));

    mgr.cancel("inst-1", ["evt-2", "evt-3"]);
    expect(stopped).toEqual([]);

    mgr.complete(registration, "evt-1");
    expect(delivered).toEqual(["evt-1"]);
  });

  // The cancel and the delivery are separate frames, and the server's sweep
  // may still have a re-push on the wire when it closes a delivery.
  it("ignores a cancelled delivery that arrives after the cancel", () => {
    const { mgr, delivered, registration } = alertQueue();

    mgr.cancel("inst-1", ["evt-1"]);
    mgr.enqueue("inst-1", item("evt-1"));

    expect(delivered).toEqual([]);
  });

  it("ignores a late completion for a delivery it already stopped", () => {
    const { mgr, delivered, registration } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.cancel("inst-1", ["evt-1"]);

    mgr.complete(registration, "evt-1");
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

describe("EventQueueManager.retainOpen", () => {
  it("cancels what an instance holds beyond its open deliveries, playing or waiting, and keeps the rest", () => {
    const { mgr, delivered, stopped } = alertQueue();
    for (const eventId of ["evt-1", "evt-2", "evt-3"]) {
      mgr.enqueue("inst-1", item(eventId));
    }

    mgr.retainOpen({ "inst-1": ["evt-3"] });

    expect(stopped).toEqual(["evt-1"]);
    expect(delivered).toEqual(["evt-1", "evt-3"]);
  });

  it("cancels everything an instance holds when it has no open deliveries", () => {
    const { mgr, stopped } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));

    mgr.retainOpen({});

    expect(stopped).toEqual(["evt-1"]);
    mgr.enqueue("inst-1", item("evt-2"));
    expect(stopped).toEqual(["evt-1"]);
  });

  it("leaves a queue alone when everything it holds is still open", () => {
    const { mgr, delivered, stopped } = alertQueue();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));

    mgr.retainOpen({ "inst-1": ["evt-1", "evt-2", "evt-9"] });

    expect(stopped).toEqual([]);
    expect(delivered).toEqual(["evt-1"]);
  });
});

describe("EventQueueManager.retainOpen during a frame swap", () => {
  it("cancels a closed event the replaced queue is still playing, so the new frame never gets it", () => {
    const mgr = new EventQueueManager();
    const oldPlayed: string[] = [];
    const newPlayed: string[] = [];
    const old = mgr.register(
      "inst-1",
      { maxInFlight: 1, autoComplete: false },
      (i) => {
        oldPlayed.push(i.eventId);
        return true;
      },
      () => {}
    );
    mgr.enqueue("inst-1", item("evt-1"));
    const fresh = mgr.register(
      "inst-1",
      { maxInFlight: 1, autoComplete: false },
      (i) => {
        newPlayed.push(i.eventId);
        return true;
      },
      () => {}
    );

    mgr.retainOpen({});
    mgr.unregister(old);

    expect(oldPlayed).toEqual(["evt-1"]);
    expect(newPlayed).toEqual([]);
    mgr.unregister(fresh);
  });
});
