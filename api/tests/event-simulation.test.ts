import { describe, expect, test } from "bun:test";
import { eventsRoutes } from "../src/routes/events";

type Published = { subject: string; payload: Record<string, unknown> };

/**
 * The routes are mixins over a context that supplies `publishEvent`. Standing
 * up the whole context to assert two fields would test the harness, so the
 * mixin is bound to a stub that records what it was asked to publish.
 */
function harness() {
  const published: Published[] = [];
  const ctx = {
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    async publishEvent(eventType: string, data: Record<string, unknown>, subject?: string, platform?: string) {
      published.push({
        subject: subject ?? eventType,
        payload: { type: eventType, data, platform },
      });
    },
  };
  return { published, routes: eventsRoutes as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, ctx };
}

describe("simulateTwitchEvent", () => {
  // The old implementation published `twitch.${eventType}`, which matched no
  // registered trigger in any vocabulary this engine has had. A simulated
  // event has to be byte-identical to a real one or it exercises a path real
  // events never take.
  test("publishes the event type verbatim, with no platform prefix", async () => {
    const { published, routes, ctx } = harness();
    await routes.simulateTwitchEvent.call(ctx, "channel.follow", { userName: "alice" });

    expect(published).toHaveLength(1);
    expect(published[0]?.subject).toBe("channel.follow");
    expect(published[0]?.payload.type).toBe("channel.follow");
  });

  // Event types are platform-agnostic since the event refactor, so `platform`
  // is the only thing telling a workflow where the event came from. Without
  // it a simulated event cannot satisfy a `${trigger.platform}` filter.
  test("stamps the originating platform", async () => {
    const { published, routes, ctx } = harness();
    await routes.simulateTwitchEvent.call(ctx, "channel.cheer", { amount: 100 });

    expect(published[0]?.payload.platform).toBe("twitch");
  });

  test("carries the event data through unchanged", async () => {
    const { published, routes, ctx } = harness();
    await routes.simulateTwitchEvent.call(ctx, "channel.follow", { userName: "bob" });

    expect(published[0]?.payload.data).toEqual({ userName: "bob" });
  });
});

describe("triggerEvent", () => {
  // The generic path was always correct; it must stay platform-free, since a
  // caller firing `db.workflow.created` is not on any platform.
  test("publishes verbatim and stamps no platform", async () => {
    const { published, routes, ctx } = harness();
    await routes.triggerEvent.call(ctx, "module.change.add", { module_id: "x" });

    expect(published[0]?.subject).toBe("module.change.add");
    expect(published[0]?.payload.platform).toBeUndefined();
  });
});
