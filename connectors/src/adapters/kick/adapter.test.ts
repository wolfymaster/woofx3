import { afterEach, describe, expect, test } from "bun:test";
import { FakeTime } from "../../host/testing";
import { KickAdapter, kickHostState } from "./adapter";
import { type FakeKickServer, startFakeKick } from "./fake-kick-server";
import { KickTokenBus, kickConfigAt, supervisedKick } from "./testing";

let kick: FakeKickServer;

afterEach(async () => {
  await kick.stop();
});

function setup() {
  kick = startFakeKick();
  const bus = new KickTokenBus();
  const deps = { config: kickConfigAt(kick.url), clock: new FakeTime(Date.now()), fetch };
  const adapter = new KickAdapter(deps, kickHostState(deps));
  return { bus, adapter, ...supervisedKick(adapter, bus) };
}

describe("KickAdapter under the supervisor", () => {
  test("a linked token connects it, and its detail shows the broadcaster", async () => {
    const { adapter, supervisor, apply } = setup();

    await apply(true, true);

    expect(supervisor.status("kick").state).toBe("connected");
    expect(adapter.detail()).toMatchObject({ broadcasterId: "4242", slug: "wolfy" });
  });

  const offline: [name: string, reply: KickTokenBus["tokenReply"], reason: string][] = [
    ["no stored token", { token: null, reason: "not_linked", error: "Kick is not linked" }, "not linked"],
    ["a link the dashboard cannot renew", { token: null, reason: "relink_required", error: "x" }, "not linked"],
  ];
  for (const [name, reply, reason] of offline) {
    test(`${name} leaves it degraded, to be retried`, async () => {
      const { bus, adapter, supervisor, apply } = setup();
      bus.tokenReply = reply;

      await apply(true, true);

      const status = supervisor.status("kick");
      expect(status.state).toBe("degraded");
      expect(status.state === "degraded" ? status.reason : "").toContain(reason);
      expect(adapter.detail()).toMatchObject({ broadcasterId: null, slug: null });
      expect(kick.requests).toEqual([]);
    });
  }

  const liveCases: [
    name: string,
    isLive: boolean,
    startTime: string | null,
    seeded: { live: boolean; startedAt?: string },
  ][] = [
    ["an offline channel", false, null, { live: false }],
    [
      "a live channel with its start",
      true,
      "2026-11-25T10:00:00Z",
      { live: true, startedAt: "2026-11-25T10:00:00.000Z" },
    ],
  ];
  for (const [name, isLive, startTime, seeded] of liveCases) {
    test(`seeds the live state of ${name}`, async () => {
      const { live, apply } = setup();
      const own = kick.state.channels[0];
      if (own === undefined) {
        throw new Error("the fake has no channel");
      }
      own.stream.is_live = isLive;
      own.stream.start_time = startTime;

      await apply(true, true);

      expect(live.seeded).toEqual([seeded]);
    });
  }

  test("is not desired unless linked and enabled", () => {
    const { adapter } = setup();
    expect([
      adapter.desired({ connected: true, enabled: true }),
      adapter.desired({ connected: true, enabled: false }),
      adapter.desired({ connected: false, enabled: true }),
    ]).toEqual([true, false, false]);
  });
});
