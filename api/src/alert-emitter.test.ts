import { describe, expect, it, mock } from "bun:test";
import {
  AlertEmitter,
  mapCheer,
  mapFollow,
  mapHypeTrain,
  mapRaid,
  mapStreamOnline,
  mapSubGift,
  mapSubscribe,
} from "./alert-emitter";
import type { Msg } from "@woofx3/nats/src/types";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function makeMsg(subject: string, payload: unknown): Msg {
  const body = JSON.stringify({ type: subject, data: payload });
  return {
    subject,
    data: new TextEncoder().encode(body),
    json: () => JSON.parse(body),
    string: () => body,
    respond: () => false,
  };
}

function setup() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    subscribe: mock(async (subject: string, handler: (msg: Msg) => void) => {
      handlers.set(subject, handler);
      return {} as any;
    }),
  } as any;
  const webhook = {
    sendAlert: mock(async () => {}),
  } as any;
  const emitter = new AlertEmitter(nats, webhook, "ch-1", fakeLogger());
  return { emitter, nats, webhook, handlers };
}

describe("Alert mappers", () => {
  it("maps follow", () => {
    expect(mapFollow({ userName: "alice" })).toEqual({ type: "follow", user: "alice" });
  });

  it("maps cheer with anonymous fallback", () => {
    expect(
      mapCheer({
        amount: 500,
        isAnonymous: true,
        message: "woo",
        userId: null,
        userName: null,
      })
    ).toEqual({
      type: "cheer",
      user: "anonymous",
      amount: 500,
      message: "woo",
      metadata: { isAnonymous: true },
    });
  });

  it("maps subscribe with tier metadata", () => {
    expect(
      mapSubscribe({
        isGift: false,
        tier: "1000",
        userId: "u1",
        userName: "alice",
      })
    ).toEqual({
      type: "subscribe",
      user: "alice",
      metadata: { tier: "1000", isGift: false },
    });
  });

  it("maps sub gift; anonymous gifter is 'anonymous'", () => {
    expect(
      mapSubGift({
        amount: 5,
        gifterId: "u2",
        gifterName: "bob",
        isAnonymous: true,
        tier: "2000",
      })
    ).toEqual({
      type: "sub_gift",
      user: "anonymous",
      amount: 5,
      metadata: { tier: "2000", isAnonymous: true },
    });
  });

  it("maps hypetrain with no user", () => {
    expect(mapHypeTrain({})).toEqual({ type: "hypetrain", user: "" });
  });

  it("maps raid with viewers as amount", () => {
    expect(
      mapRaid({
        fromBroadcasterUserId: "b1",
        fromBroadcasterUserName: "RaidingStreamer",
        viewers: 42,
      })
    ).toEqual({ type: "raid", user: "RaidingStreamer", amount: 42 });
  });

  it("maps stream online", () => {
    expect(mapStreamOnline({})).toEqual({ type: "stream_online", user: "" });
  });
});

describe("AlertEmitter wiring", () => {
  it("subscribes to all seven Twitch subjects on start", async () => {
    const { emitter, nats } = setup();
    await emitter.start();
    const subjects = nats.subscribe.mock.calls.map((c: any) => c[0]).sort();
    expect(subjects).toEqual(
      [
        "cheer.user.twitch",
        "follow.user.twitch",
        "hypetrain.channel.twitch",
        "online.user.twitch",
        "raid.user.twitch",
        "subscribe.user.twitch",
        "subscription.gift.twitch",
      ].sort()
    );
  });

  it("forwards a follow event to the webhook with the configured channelId", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("follow.user.twitch")!(makeMsg("follow.user.twitch", { userName: "alice" }));
    await Promise.resolve();
    expect(webhook.sendAlert).toHaveBeenCalledTimes(1);
    expect(webhook.sendAlert).toHaveBeenCalledWith("ch-1", { type: "follow", user: "alice" });
  });

  it("forwards a raid event", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("raid.user.twitch")!(
      makeMsg("raid.user.twitch", {
        fromBroadcasterUserId: "b1",
        fromBroadcasterUserName: "RaidingStreamer",
        viewers: 42,
      })
    );
    await Promise.resolve();
    expect(webhook.sendAlert).toHaveBeenCalledWith("ch-1", {
      type: "raid",
      user: "RaidingStreamer",
      amount: 42,
    });
  });

  it("swallows malformed CloudEvent payloads without crashing", async () => {
    const { emitter, webhook, handlers, nats: _nats } = setup();
    await emitter.start();
    const badMsg: Msg = {
      subject: "follow.user.twitch",
      data: new TextEncoder().encode("not-json"),
      json: () => {
        throw new Error("invalid json");
      },
      string: () => "not-json",
      respond: () => false,
    };
    expect(() => handlers.get("follow.user.twitch")!(badMsg)).not.toThrow();
    await Promise.resolve();
    expect(webhook.sendAlert).not.toHaveBeenCalled();
  });

  it("setChannelId updates routing for subsequent events", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    emitter.setChannelId("ch-2");
    handlers.get("follow.user.twitch")!(makeMsg("follow.user.twitch", { userName: "bob" }));
    await Promise.resolve();
    expect(webhook.sendAlert).toHaveBeenCalledWith("ch-2", { type: "follow", user: "bob" });
  });
});
