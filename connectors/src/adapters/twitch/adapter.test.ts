import { describe, expect, mock, spyOn, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import type { EventSubSubscription } from "@twurple/eventsub-base";
import { TWITCHAPI_SERVED_BUDGET_MS } from "@woofx3/common/cloudevents/Twitch/commands";
import { EventType as TwitchEventType } from "@woofx3/common/cloudevents/Twitch/events";
import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
} from "@woofx3/common/integrations/integration-settings";
import { FakeDispatcherDb } from "../../chat/testing";
import { ChatEnvSchema, chatConfig } from "../../config/chat";
import { GatewayEnvSchema, gatewayConfig } from "../../config/gateway";
import { HostEnvSchema, hostConfig } from "../../config/host";
import { TWITCH_DEFAULTS, type TwitchConfig } from "../../config/twitch";
import type { Unavailable } from "../../host/adapter";
import { systemTimers } from "../../host/deps";
import { Host } from "../../host/host";
import { Supervisor } from "../../host/supervisor";
import {
  bytes,
  countingIds,
  FakeBus,
  FakeTime,
  fixedLinkStore,
  flush,
  halfRandom,
  noCompanion,
  RecordingLogger,
  shippedLinkReaders,
  testCompanion,
  text,
} from "../../host/testing";
import { HELIX_DEADLINE_MS } from "./lib/helix";

/** EventSub listeners started and not stopped since, across every client. */
const liveListeners = new Set<object>();

/** An EventSub listener that confirms every subscription as it is created. */
function confirmingListener() {
  const successHandlers: Array<(sub: EventSubSubscription) => void> = [];
  const base: Record<string, unknown> = {
    start: () => {
      liveListeners.add(base);
    },
    stop: () => {
      liveListeners.delete(base);
    },
    onSubscriptionCreateSuccess: (handler: (sub: EventSubSubscription) => void) => {
      successHandlers.push(handler);
      return { unbind: () => {} };
    },
    onSubscriptionCreateFailure: () => ({ unbind: () => {} }),
  };
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      if (prop.startsWith("on")) {
        return () => {
          const sub = { id: prop, start: () => {}, stop: () => {} } as unknown as EventSubSubscription;
          for (const handler of successHandlers) {
            handler(sub);
          }
          return sub;
        };
      }
      return undefined;
    },
  });
}

/** Whether a Twitch token is stored, as TwitchClient.init sees it. */
let linked = true;

class NotLinkedError extends Error {
  constructor() {
    super("Missing broadcaster token in db proxy setting: twitch_token");
    this.name = "TwitchNotLinked";
  }
}

type AuthFailureHandler = (err: Error, info: { provider: "refreshing" | "dashboard" }) => void;

/** The auth provider every connected client hands back, for the Helix calls egress makes. */
const fakeAuthProvider = {
  clientId: "client-1",
  getAccessTokenForUser: async () => ({
    accessToken: "token-1",
    refreshToken: null,
    scope: [],
    expiresIn: null,
    obtainmentTimestamp: 0,
    userId: "broadcaster-1",
  }),
};

/** Every client the adapter built, newest last. */
const clients: MockTwitchClient[] = [];

class MockTwitchClient {
  constructor(readonly args: { onAuthFailure?: AuthFailureHandler }) {
    clients.push(this);
  }

  init = mock(async () => {
    if (!linked) {
      throw new NotLinkedError();
    }
    return fakeAuthProvider;
  });
  ApiClient = mock(() => ({ streams: { getStreamByUserId: async () => null } }));
  EventBusListener = mock(() => confirmingListener());
  broadcaster = mock(async () => ({ id: "broadcaster-1", displayName: "Stream" }) as HelixUser);
  reloadToken = mock(async () => ({ userId: "42", userChanged: false, providerChanged: false }));
  close = mock(async () => {});
}

mock.module("@woofx3/twitch", () => ({
  default: MockTwitchClient,
  requestTokenOverNats: () => async () => {
    throw new Error("no dashboard in this test");
  },
  TWITCH_NOT_LINKED: "TwitchNotLinked",
}));

const { TWITCH_EVENT_SUBJECTS, TwitchAdapter, twitchApiUnavailableReply } = await import("./adapter");

const CONFIG: TwitchConfig = {
  channel: undefined,
  app: undefined,
  membership: {
    ttlMs: TWITCH_DEFAULTS.membershipTtlMs,
    deadlineMs: TWITCH_DEFAULTS.membershipDeadlineMs,
    loadTimeoutMs: TWITCH_DEFAULTS.membershipLoadTimeoutMs,
    failureTtlMs: TWITCH_DEFAULTS.membershipFailureTtlMs,
    maxEntries: TWITCH_DEFAULTS.membershipMaxEntries,
  },
  sendQueueCap: TWITCH_DEFAULTS.sendQueueCap,
  selfSent: { capacity: TWITCH_DEFAULTS.selfSentCapacity, ttlMs: TWITCH_DEFAULTS.selfSentTtlMs },
};

function newAdapter(time = new FakeTime()) {
  return new TwitchAdapter({
    config: CONFIG,
    clock: time,
    ids: countingIds(),
    timers: systemTimers,
    random: halfRandom,
  });
}

function errorOf(reply: Uint8Array): { type: string; data: { error: string; code?: string } } {
  return JSON.parse(text(reply)) as { type: string; data: { error: string; code?: string } };
}

describe("TwitchAdapter manifest", () => {
  const { manifest } = newAdapter();

  test("publishes every Twitch event subject and nothing else", () => {
    expect([...manifest.publishes].sort()).toEqual(Object.values(TwitchEventType).sort());
    expect(TWITCH_EVENT_SUBJECTS).toContain("user.message");
  });

  test("hears relinks, asks the api for tokens and shoutouts, and serves twitchapi", () => {
    expect(manifest.subscribes).toEqual([INTEGRATION_TOKEN_UPDATED_SUBJECT]);
    expect(manifest.requests).toEqual(["engine.twitch.token", "engine.shoutout.enqueue"]);
    expect(manifest.serves.map((served) => [served.subject, served.budgetMs])).toEqual([
      ["twitchapi", TWITCHAPI_SERVED_BUDGET_MS],
    ]);
  });

  test("performs every platform gateway chat action", () => {
    expect(Object.keys(manifest.egress ?? {}).sort()).toEqual(["chat.announce", "chat.pin", "chat.send"]);
  });

  test("gives a Helix call room to report its own timeout inside the served budget", () => {
    expect(HELIX_DEADLINE_MS).toBeLessThan(TWITCHAPI_SERVED_BUDGET_MS);
  });
});

describe("TwitchAdapter desired", () => {
  const cases: Array<[connected: boolean, enabled: boolean, desired: boolean]> = [
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ];
  for (const [connected, enabled, desired] of cases) {
    test(`connected=${connected} enabled=${enabled} -> ${desired}`, () => {
      expect(newAdapter().desired({ connected, enabled })).toBe(desired);
    });
  }
});

describe("twitchApiUnavailableReply", () => {
  const deps = { clock: new FakeTime(), ids: countingIds() };
  const linkedOn = { connected: true, enabled: true };
  const linkedOff = { connected: true, enabled: false };
  const unlinked = { connected: false, enabled: false };
  const cases: Array<[name: string, unavailable: Unavailable, code: string, says: string]> = [
    ["nothing linked", { reason: "stopped", link: unlinked }, "not_linked", "not linked"],
    ["nothing linked while it settles", { reason: "starting", link: unlinked }, "not_linked", "not linked"],
    ["linked but turned off", { reason: "stopped", link: linkedOff }, "integration_unavailable", "turned off"],
    ["still connecting", { reason: "starting", link: linkedOn }, "integration_unavailable", "still connecting"],
    ["parked", { reason: "parked", link: linkedOn }, "integration_unavailable", "failed repeatedly"],
    ["link not read yet", { reason: "starting", link: null }, "integration_unavailable", "not running"],
  ];
  for (const [name, unavailable, code, says] of cases) {
    test(`${name} -> ${code}`, () => {
      const reply = errorOf(twitchApiUnavailableReply(unavailable, deps));
      expect(reply.type).toBe("twitchapi.error");
      expect(reply.data.code).toBe(code);
      expect(reply.data.error).toContain(says);
    });
  }
});

function supervised() {
  const bus = new FakeBus();
  const time = new FakeTime();
  const adapter = newAdapter(time);
  const supervisor = new Supervisor(
    new Map([["twitch", adapter]]),
    {
      backoff: { baseMs: 1_000, maxMs: 10_000 },
      park: { afterFailures: 5, windowMs: 600_000 },
      stopDeadlineMs: 5_000,
      subscriptionLimits: { concurrency: 4, queueCap: 16 },
    },
    {
      bus,
      dbProxy: { baseURL: "http://db.test" },
      companion: noCompanion,
      clock: time,
      random: halfRandom,
      timers: time,
      logger: new RecordingLogger(),
    }
  );
  const apply = async (connected: boolean, enabled: boolean) => {
    await supervisor.reconcile(new Map([["twitch", { connected, enabled }]]), new Set(["twitch" as const]));
    await supervisor.whenIdle();
  };
  return { bus, time, adapter, supervisor, apply };
}

describe("TwitchAdapter under the supervisor", () => {
  test("a linked token connects it and its detail shows the broadcaster and EventSub", async () => {
    linked = true;
    const { adapter, supervisor, apply } = supervised();

    await apply(true, true);

    expect(supervisor.status("twitch").state).toBe("connected");
    expect(adapter.detail()).toEqual({
      broadcasterId: "broadcaster-1",
      eventSub: { established: expect.any(Number), expected: expect.any(Number), ready: true },
      ownLinesAwaitingEcho: 0,
    });
  });

  test("no stored token after all leaves it degraded, to be retried", async () => {
    linked = false;
    const { adapter, supervisor, apply } = supervised();

    await apply(true, true);

    const status = supervisor.status("twitch");
    expect(status.state).toBe("degraded");
    expect(status.state === "degraded" ? status.reason : "").toContain("not linked");
    expect(adapter.detail()).toEqual({ broadcasterId: null, eventSub: null, ownLinesAwaitingEcho: 0 });
  });

  test("start, stop, start leaves one relink listener", async () => {
    linked = true;
    const { bus, supervisor, apply } = supervised();

    await apply(true, true);
    await apply(true, false);
    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(bus.active(INTEGRATION_TOKEN_UPDATED_SUBJECT)).toBe(0);
    await apply(true, true);

    expect(supervisor.status("twitch").state).toBe("connected");
    expect(bus.active(INTEGRATION_TOKEN_UPDATED_SUBJECT)).toBe(1);
  });

  test("enable, disable and re-enable cycles leave one EventSub listener", async () => {
    linked = true;
    liveListeners.clear();
    const { supervisor, apply } = supervised();

    for (let cycle = 0; cycle < 3; cycle++) {
      await apply(true, true);
      expect(liveListeners.size).toBe(1);
      await apply(true, false);
      expect(liveListeners.size).toBe(0);
    }
    await apply(true, true);

    expect(supervisor.status("twitch").state).toBe("connected");
    expect(liveListeners.size).toBe(1);
  });
});

describe("TwitchAdapter egress", () => {
  const egressCtx = () => ({
    signal: new AbortController().signal,
    deadline: new FakeTime().now() + 9_000,
    requestedBy: { kind: "workflow" as const, ref: "workflow-1" },
    markSent: () => {},
  });

  test("answers stopped while the adapter is not running, without calling Twitch", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      const send = newAdapter().manifest.egress?.["chat.send"];
      expect(await send?.handle({ message: "hi" }, undefined, egressCtx())).toEqual({
        status: "unavailable",
        reason: "stopped",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("posts through the running connection as the broadcaster, and answers stopped again after stop", async () => {
    linked = true;
    const { adapter, apply } = supervised();
    const fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(
      (async () =>
        new Response(JSON.stringify({ data: [{ message_id: "m-1", is_sent: true }] }), {
          status: 200,
        })) as unknown as typeof fetch
    );
    try {
      await apply(true, true);
      const send = adapter.manifest.egress?.["chat.send"];

      expect(await send?.handle({ message: "hi" }, undefined, egressCtx())).toEqual({
        status: "delivered",
        messageId: "m-1",
      });
      const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
      expect(body).toEqual({ broadcaster_id: "broadcaster-1", sender_id: "broadcaster-1", message: "hi" });

      await apply(true, false);
      expect(await send?.handle({ message: "hi" }, undefined, egressCtx())).toEqual({
        status: "unavailable",
        reason: "stopped",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("TwitchAdapter token renewal failures under the supervisor", () => {
  const REASON = "Twitch token renewal failed (refreshing): Invalid refresh token";

  test("leave it degraded with the reason, and repeated ones park it", async () => {
    linked = true;
    clients.length = 0;
    const { time, supervisor, apply } = supervised();
    const failRenewal = async () => {
      clients.at(-1)?.args.onAuthFailure?.(new Error("Invalid refresh token"), { provider: "refreshing" });
      await flush();
      await supervisor.whenIdle();
    };

    await apply(true, true);
    await failRenewal();
    expect(supervisor.status("twitch")).toEqual({ state: "degraded", reason: REASON, retryAt: expect.any(Number) });

    // park.afterFailures is 5; each retry reconnects and fails its renewal again.
    for (let fault = 2; fault <= 5; fault++) {
      await time.advance(10_000);
      await supervisor.whenIdle();
      expect(supervisor.status("twitch").state).toBe("connected");
      await failRenewal();
    }

    expect(supervisor.status("twitch")).toEqual({ state: "parked", reason: REASON });
    expect(supervisor.report().find((entry) => entry.id === "twitch")?.counts.faults).toBe(5);
  });
});

describe("TwitchAdapter in the host", () => {
  function event(subject: string, data: Record<string, unknown>): Uint8Array {
    return bytes(JSON.stringify({ specversion: "1.0", id: "e", type: subject, source: "api", data }));
  }

  test("enabling starts it, disabling answers integration_unavailable, unlinking stops EventSub and answers not_linked", async () => {
    linked = true;
    liveListeners.clear();
    const values: Record<string, string> = { twitch_token: "tok", "integration.twitch.enabled": "true" };
    const settings = fixedLinkStore(values);
    const bus = new FakeBus();
    const time = new FakeTime();
    const host = new Host({
      config: hostConfig(HostEnvSchema.parse({})),
      gateway: gatewayConfig(GatewayEnvSchema.parse({})),
      chat: chatConfig(ChatEnvSchema.parse({})),
      dispatcherDb: new FakeDispatcherDb(),
      companion: testCompanion(),
      dbProxy: { baseURL: "http://db.test" },
      bus,
      busConnected: () => true,
      linkStore: settings,
      adapters: new Map([["twitch", newAdapter(time)]]),
      hostStates: new Map([["twitch", undefined]]),
      readers: shippedLinkReaders(),
      clock: time,
      random: halfRandom,
      ids: countingIds(),
      timers: time,
      logger: new RecordingLogger(),
    });
    const announce = async () => {
      bus.deliver(
        INTEGRATION_ENABLED_UPDATED_SUBJECT,
        event(INTEGRATION_ENABLED_UPDATED_SUBJECT, { integration: "twitch" })
      );
      bus.deliver(
        INTEGRATION_TOKEN_UPDATED_SUBJECT,
        event(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: "twitch" })
      );
      await flush();
      await host.settled();
    };
    const ask = async () => {
      // An operation helix does not declare: the adapter refuses it itself, before calling Twitch.
      const request = { command: "helix", args: { operation: "noSuchOperation" } };
      const replies = bus.deliver("twitchapi", bytes(JSON.stringify(request)), "inbox");
      await flush();
      return replies.map((reply) => errorOf(reply).data.code);
    };

    await host.start();
    await host.settled();
    expect(await ask()).toEqual(["invalid_arguments"]);

    values["integration.twitch.enabled"] = "false";
    await announce();
    expect(await ask()).toEqual(["integration_unavailable"]);

    values["integration.twitch.enabled"] = "true";
    await announce();
    expect(liveListeners.size).toBe(1);

    values.twitch_token = "";
    await announce();
    expect(await ask()).toEqual(["not_linked"]);
    expect(liveListeners.size).toBe(0);

    values.twitch_token = "tok";
    await announce();
    expect(await ask()).toEqual(["invalid_arguments"]);

    await host.stop();
  });
});
