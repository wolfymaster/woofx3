import { describe, expect, it } from "bun:test";
import { EventQueueManager } from "../../public/scene-manager/event-queue";

function item(eventId: string) {
  return { eventId, type: "alert", key: "alert-1", value: null };
}

function deliveringManager() {
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
  return { mgr, delivered };
}

describe("EventQueueManager — server redelivery", () => {
  it("ignores a redelivery of an event that is queued or in flight", () => {
    const { mgr, delivered } = deliveringManager();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.enqueue("inst-1", item("evt-2"));
    mgr.complete("sub-1", "evt-1");
    mgr.complete("sub-1", "evt-2");
    expect(delivered).toEqual(["evt-1", "evt-2"]);
  });

  it("ignores a redelivery of an event that already finished", () => {
    const { mgr, delivered } = deliveringManager();
    mgr.enqueue("inst-1", item("evt-1"));
    mgr.complete("sub-1", "evt-1");
    mgr.enqueue("inst-1", item("evt-1"));
    expect(delivered).toEqual(["evt-1"]);
  });
});
