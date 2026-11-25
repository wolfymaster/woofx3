import { afterEach, describe, expect, test } from "bun:test";
import { FakeTime } from "../../host/testing";
import { KickAdapter, kickHostState } from "./adapter";
import { type FakeKickServer, startFakeKick } from "./fake-kick-server";
import { channelFollowed, chatMessageSent, livestreamStatusUpdated } from "./fixtures";
import { KickTokenBus, kickConfigAt, kickDelivery, kickSigningKey, supervisedKick } from "./testing";

const SENT_AT = "2026-11-25T10:00:00Z";

/** A token bus whose publishes can be made to fail, as a closed scope or a NATS outage does. */
class FlakyBus extends KickTokenBus {
  failPublishes = 0;

  override async publish(subject: string, data: Uint8Array): Promise<void> {
    if (this.failPublishes > 0) {
      this.failPublishes--;
      throw new Error("the bus is down");
    }
    return super.publish(subject, data);
  }
}

let kick: FakeKickServer;

afterEach(async () => {
  await kick.stop();
});

async function running() {
  kick = startFakeKick();
  const key = await kickSigningKey();
  kick.state.publicKeyPem = key.pem;
  const bus = new FlakyBus();
  const time = new FakeTime(Date.parse(SENT_AT));
  const deps = { config: kickConfigAt(kick.url), clock: time, fetch };
  const hostState = kickHostState(deps);
  const adapter = new KickAdapter(deps, hostState);
  const supervised = supervisedKick(adapter, bus, time);
  await supervised.apply(true, true);
  const served = adapter.manifest.serves.find((s) => s.subject === "engine.kick.webhook");
  if (served === undefined) {
    throw new Error("the adapter does not serve engine.kick.webhook");
  }
  const deliver = async (request: Uint8Array) =>
    JSON.parse(
      new TextDecoder().decode(
        await served.handle(request, { deadline: 0, signal: new AbortController().signal, hostState })
      )
    );
  const follow = (messageId = "01FOLLOW", overrides: Partial<Parameters<typeof kickDelivery>[1]> = {}) =>
    kickDelivery(key, {
      messageId,
      timestamp: SENT_AT,
      eventType: "channel.followed",
      body: channelFollowed,
      ...overrides,
    });
  const subjects = () => bus.published.map((p) => p.subject).filter((s) => s !== "stream.status.observed");
  return { bus, time, adapter, served, deliver, follow, key, subjects, ...supervised };
}

describe("engine.kick.webhook", () => {
  test("a signed delivery is published, then acknowledged", async () => {
    const { deliver, follow, subjects } = await running();
    expect(await deliver(await follow())).toEqual({ status: 200, reason: "published" });
    expect(subjects()).toEqual(["channel.follow"]);
  });

  test("a redelivery is acknowledged and publishes nothing", async () => {
    const { deliver, follow, subjects } = await running();
    await deliver(await follow());
    expect(await deliver(await follow())).toEqual({ status: 200, reason: "duplicate" });
    expect(subjects()).toEqual(["channel.follow"]);
  });

  test("another channel's delivery is acknowledged and dropped", async () => {
    const { deliver, follow, subjects } = await running();
    const body = { ...channelFollowed, broadcaster: { ...channelFollowed.broadcaster, user_id: 9999 } };
    expect(await deliver(await follow("01OTHER", { body }))).toEqual({ status: 200, reason: "ignored" });
    expect(subjects()).toEqual([]);
  });

  const stale: [name: string, timestamp: string][] = [
    ["an hour and a minute old", "2026-11-25T08:59:00Z"],
    ["an hour and a minute ahead", "2026-11-25T11:01:00Z"],
    ["not a time", "yesterday"],
  ];
  for (const [name, timestamp] of stale) {
    test(`a delivery ${name} is refused as stale`, async () => {
      const { deliver, follow, subjects } = await running();
      expect(await deliver(await follow("01STALE", { timestamp }))).toEqual({ status: 401, reason: "stale" });
      expect(subjects()).toEqual([]);
    });
  }

  test("a delivery Kick did not sign is refused", async () => {
    const { deliver } = await running();
    const forger = await kickSigningKey();
    const forged = await kickDelivery(forger, {
      messageId: "01FORGED",
      timestamp: SENT_AT,
      eventType: "channel.followed",
      body: channelFollowed,
    });
    expect(await deliver(forged)).toEqual({ status: 401, reason: "bad_signature" });
  });

  const malformed: [name: string, request: string][] = [
    ["not JSON", "nope"],
    [
      "missing its signature",
      JSON.stringify({
        messageId: "m",
        timestamp: SENT_AT,
        eventType: "x",
        eventVersion: "1",
        subscriptionId: "s",
        bodyBase64: "",
      }),
    ],
  ];
  for (const [name, request] of malformed) {
    test(`a request ${name} is malformed`, async () => {
      const { deliver } = await running();
      expect(await deliver(new TextEncoder().encode(request))).toEqual({ status: 400, reason: "malformed" });
    });
  }

  test("a failed publish is a 500 and not remembered, so Kick's retry publishes once", async () => {
    const { bus, deliver, follow, subjects } = await running();
    bus.failPublishes = 1;
    expect(await deliver(await follow())).toEqual({ status: 500, reason: "publish_failed" });
    expect(await deliver(await follow())).toEqual({ status: 200, reason: "published" });
    expect(subjects()).toEqual(["channel.follow"]);
  });

  test("a stream going live is published and told to the live status board", async () => {
    const { deliver, key, live, subjects } = await running();
    const request = await kickDelivery(key, {
      messageId: "01LIVE",
      timestamp: SENT_AT,
      eventType: "livestream.status.updated",
      body: livestreamStatusUpdated,
    });
    expect(await deliver(request)).toEqual({ status: 200, reason: "published" });
    expect(subjects()).toEqual(["stream.online"]);
    expect(live.changed).toEqual([{ live: true, startedAt: "2026-11-25T10:00:00.000Z" }]);
  });

  test("an unknown event type is acknowledged and ignored", async () => {
    const { deliver, key, subjects } = await running();
    const request = await kickDelivery(key, {
      messageId: "01BAN",
      timestamp: SENT_AT,
      eventType: "moderation.banned",
      body: { broadcaster: chatMessageSent.broadcaster },
    });
    expect(await deliver(request)).toEqual({ status: 200, reason: "ignored" });
    expect(subjects()).toEqual([]);
  });

  test("while the adapter is stopped the host answers unavailable, so Kick retries", async () => {
    const { served, apply } = await running();
    await apply(true, false);
    const reply = JSON.parse(new TextDecoder().decode(served.unavailableReply({ reason: "stopped", link: null })));
    expect(reply).toEqual({ status: 503, reason: "unavailable" });
  });
});
