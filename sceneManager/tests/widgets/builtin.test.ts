import { describe, expect, it } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/Twitch";
import { getBuiltinWidgetSpecs } from "../../src/widgets/builtin";

// `fanOutToConnectedScenes` matches an instance's `acceptedEvents`
// against the alert envelope's `event.type` by exact string equality,
// and a value matching nothing is dropped with no error on any path.
// These assertions are the only thing standing between a typo and
// silently undelivered alerts.
describe("built-in widget acceptedEvents", () => {
  const emitted = new Set<string>(Object.values(EventType));

  it("declares only event types the platform actually emits", () => {
    const unmatched = getBuiltinWidgetSpecs().flatMap((spec) =>
      spec.acceptedEvents.filter((e) => !emitted.has(e)).map((e) => `${spec.manifestId}: ${e}`)
    );
    expect(unmatched).toEqual([]);
  });

  it("declares raw event types rather than canonical trigger ids", () => {
    const canonical = getBuiltinWidgetSpecs().flatMap((spec) =>
      spec.acceptedEvents.filter((e) => e.includes(":trigger:")).map((e) => `${spec.manifestId}: ${e}`)
    );
    expect(canonical).toEqual([]);
  });

  it("accepts at least one event per built-in widget", () => {
    for (const spec of getBuiltinWidgetSpecs()) {
      expect(spec.acceptedEvents.length).toBeGreaterThan(0);
    }
  });

  it("covers the alert events media_alert renders", () => {
    const mediaAlert = getBuiltinWidgetSpecs().find((s) => s.manifestId === "media_alert");
    expect(mediaAlert).toBeDefined();
    expect(mediaAlert!.acceptedEvents).toEqual([
      EventType.Follow,
      EventType.Cheer,
      EventType.Subscribe,
      EventType.SubscriptionGift,
      EventType.Redeem,
      EventType.Raid,
      EventType.StreamOnline,
      EventType.StreamOffline,
    ]);
  });
});
