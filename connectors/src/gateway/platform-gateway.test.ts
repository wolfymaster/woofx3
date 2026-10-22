import { describe, expect, test } from "bun:test";
import {
  type GatewayReply,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformId,
  type PlatformOutcome,
  type PlatformResults,
  parseGatewayReply,
} from "@woofx3/api/platform-gateway";
import { GATEWAY_DEFAULTS, GatewayEnvSchema, gatewayConfig } from "../config/gateway";
import type { AdapterManifest, AdapterStatus, EgressContext, EgressHandlerSpec, EgressHandlers } from "../host/adapter";
import type { AdapterId } from "../host/adapter-ids";
import { HostRequests, parsed, parseFailed } from "../host/host-requests";
import type { LinkState } from "../host/link-readers";
import { ScopeCounters, ScopedBus } from "../host/scoped-bus";
import type { StatusListener } from "../host/supervisor";
import {
  bytes,
  countingIds,
  disabled,
  FakeBus,
  FakeTime,
  flush,
  linked,
  RecordingLogger,
  text,
  unlinked,
} from "../host/testing";
import { EgressRegistry } from "./egress-registry";
import { GATEWAY_SEND_RESULT_TYPE, type GatewayAdapters, PlatformGateway } from "./platform-gateway";

const SEND = PLATFORM_GATEWAY_SUBJECTS.send;
const DEADLINE_MS = GATEWAY_DEFAULTS.adapterDeadlineMs;

// The contract has one platform. A second, test-only id lets fan-out run
// across two; requests reach it only through target "all".
const KICK = "kick" as PlatformId;
const CATALOG: readonly PlatformId[] = ["twitch", KICK];

/** The supervisor's view the gateway reads, driven by hand. */
class FakePlatforms implements GatewayAdapters {
  private readonly statuses = new Map<AdapterId, AdapterStatus>();
  private readonly links = new Map<AdapterId, LinkState>();
  private readonly listeners = new Set<StatusListener>();

  status(id: AdapterId): AdapterStatus {
    return this.statuses.get(id) ?? { state: "stopped" };
  }

  link(id: AdapterId): LinkState | null {
    return this.links.get(id) ?? null;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(id: string, link: LinkState, status: AdapterStatus): void {
    this.links.set(id as AdapterId, link);
    this.statuses.set(id as AdapterId, status);
    for (const listener of this.listeners) {
      listener(id as AdapterId, status);
    }
  }

  running(id: string): void {
    this.set(id, linked, { state: "connected", since: 0 });
  }
}

interface Call {
  payload: unknown;
  options: unknown;
  ctx: EgressContext;
}

/** An egress handler that records its calls and answers with `answer`. */
function recording<A extends "chat.send" | "chat.announce" | "chat.pin">(
  answer: (ctx: EgressContext) => Promise<PlatformOutcome> = async () => ({ status: "delivered", messageId: "m-1" }),
  parseOptions?: EgressHandlerSpec<A>["parseOptions"]
): { spec: EgressHandlerSpec<A>; calls: Call[] } {
  const calls: Call[] = [];
  const spec: EgressHandlerSpec<A> = {
    handle: (payload, options, ctx) => {
      calls.push({ payload, options, ctx });
      return answer(ctx);
    },
  };
  if (parseOptions !== undefined) {
    spec.parseOptions = parseOptions;
  }
  return { spec, calls };
}

function manifest(id: string, egress?: EgressHandlers): AdapterManifest {
  return { id: id as AdapterId, publishes: [], subscribes: [], requests: [], serves: [], egress };
}

async function setup(manifests: AdapterManifest[], env: Record<string, unknown> = {}) {
  const time = new FakeTime();
  const bus = new FakeBus();
  const logger = new RecordingLogger();
  const requests = new HostRequests({ clock: time, ids: countingIds(), timers: time, logger });
  const scope = new ScopedBus({
    scope: "host",
    client: bus,
    grants: { publishes: [], subscribes: [SEND], requests: [] },
    limits: { concurrency: 16, queueCap: 16 },
    logger,
    counters: new ScopeCounters(),
    clock: time,
  });
  const platforms = new FakePlatforms();
  const gateway = new PlatformGateway({
    config: gatewayConfig(GatewayEnvSchema.parse(env)),
    egress: EgressRegistry.fromManifests(manifests, CATALOG),
    adapters: platforms,
    requests,
    clock: time,
    logger,
  });
  await gateway.serve(scope);

  /** Sends a request and lets it reach its handlers; the returned list fills with the reply once it is sent. */
  const ask = async (request: Record<string, unknown>): Promise<Uint8Array[]> => {
    const replies = bus.deliver(SEND, bytes(JSON.stringify(request)), "inbox");
    await flush();
    return replies;
  };
  const send = async (request: Record<string, unknown>): Promise<GatewayReply> => only(await ask(request));
  return { time, bus, logger, requests, platforms, gateway, ask, send };
}

/**
 * The one reply's GatewayReply. Checked against the contract's reply parser
 * unless it carries the test-only platform, which the parser rightly refuses.
 */
function only(replies: Uint8Array[]): GatewayReply {
  expect(replies).toHaveLength(1);
  const event = JSON.parse(text(replies[0] as Uint8Array)) as { type: string; data: GatewayReply };
  expect(event.type).toBe(GATEWAY_SEND_RESULT_TYPE);
  if (event.data.results[KICK] === undefined) {
    const reply = parseGatewayReply(event.data);
    if (!reply.ok) {
      throw new Error(`reply does not parse: ${reply.error.field} ${reply.error.problem}`);
    }
  }
  return event.data;
}

let nextKey = 0;

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nextKey++;
  return {
    action: "chat.send",
    target: { kind: "all" },
    payload: { message: "hello chat" },
    idempotencyKey: `key-${nextKey}`,
    requestedBy: { kind: "workflow", ref: "workflow-1" },
    ...overrides,
  };
}

const delivered: PlatformOutcome = { status: "delivered", messageId: "m-1" };

/** Results that may name the test-only platform, which PlatformResults has no key for. */
function results(byPlatform: Record<string, PlatformOutcome>): PlatformResults {
  return byPlatform as PlatformResults;
}

describe("PlatformGateway targets", () => {
  test("all reaches every linked and enabled platform and reports the ones without the action", async () => {
    const twitch = recording<"chat.announce">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.announce": twitch.spec }), manifest(KICK, {})]);
    platforms.running("twitch");
    platforms.running(KICK);

    const reply = await send(request({ action: "chat.announce", payload: { message: "hi" } }));
    expect(reply).toEqual({ ok: true, results: results({ twitch: delivered, kick: { status: "unsupported" } }) });
    expect(twitch.calls).toHaveLength(1);
  });

  test("all leaves unlinked and disabled platforms out, and is not ok when none is left", async () => {
    const twitch = recording<"chat.send">();
    const kick = recording<"chat.send">();
    const { platforms, send } = await setup([
      manifest("twitch", { "chat.send": twitch.spec }),
      manifest(KICK, { "chat.send": kick.spec }),
    ]);
    platforms.set("twitch", unlinked, { state: "stopped" });
    platforms.set(KICK, disabled, { state: "stopped" });

    expect(await send(request())).toEqual({ ok: false, results: {} });
    expect(twitch.calls).toHaveLength(0);
    expect(kick.calls).toHaveLength(0);
  });

  test("platforms refuses a platform that cannot perform the action", async () => {
    const { platforms, send } = await setup([manifest("twitch", {})]);
    platforms.running("twitch");

    const reply = await send(request({ target: { kind: "platforms", ids: ["twitch"] } }));
    expect(reply.ok).toBe(false);
    expect(reply.results).toEqual({});
    expect(reply.error).toEqual({ code: "invalid", message: 'target.ids[0]: "twitch" cannot perform chat.send' });
  });

  test("platforms refuses a platform with no adapter loaded", async () => {
    const { send } = await setup([]);
    const reply = await send(request({ target: { kind: "platforms", ids: ["twitch"] } }));
    expect(reply.error?.code).toBe("invalid");
  });

  test("origin replies in-thread to the origin's message and ignores its channelId", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const reply = await send(
      request({ target: { kind: "origin", origin: { platform: "twitch", messageId: "chat-9", channelId: "other" } } })
    );
    expect(reply).toEqual({ ok: true, results: { twitch: delivered } });
    expect(twitch.calls[0]?.payload).toEqual({ message: "hello chat", replyToMessageId: "chat-9" });
  });

  test("origin on a platform without the action is unsupported, not refused", async () => {
    const { platforms, send } = await setup([manifest("twitch", {})]);
    platforms.running("twitch");

    const reply = await send(request({ target: { kind: "origin", origin: { platform: "twitch" } } }));
    expect(reply).toEqual({ ok: false, results: { twitch: { status: "unsupported" } } });
  });
});

describe("PlatformGateway reply ok", () => {
  const failed: PlatformOutcome = { status: "failed", code: "forbidden", message: "no" };
  const rows: Array<[name: string, target: Record<string, unknown>, kick: PlatformOutcome, ok: boolean]> = [
    ["all: one of two delivered", { kind: "all" }, failed, true],
    ["all: both delivered", { kind: "all" }, delivered, true],
    ["platforms: the only one named delivered", { kind: "platforms", ids: ["twitch"] }, failed, true],
    ["origin: its platform delivered", { kind: "origin", origin: { platform: "twitch" } }, failed, true],
  ];
  for (const [name, target, kickOutcome, ok] of rows) {
    test(name, async () => {
      const twitch = recording<"chat.send">();
      const kick = recording<"chat.send">(async () => kickOutcome);
      const { platforms, send } = await setup([
        manifest("twitch", { "chat.send": twitch.spec }),
        manifest(KICK, { "chat.send": kick.spec }),
      ]);
      platforms.running("twitch");
      platforms.running(KICK);
      expect((await send(request({ target }))).ok).toBe(ok);
    });
  }

  test("platforms: a named platform that did not deliver fails the reply", async () => {
    const twitch = recording<"chat.send">(async () => ({ status: "dropped", reason: "automod" }));
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const reply = await send(request({ target: { kind: "platforms", ids: ["twitch"] } }));
    expect(reply).toEqual({ ok: false, results: { twitch: { status: "dropped", reason: "automod" } } });
  });
});

describe("PlatformGateway availability", () => {
  const rows: Array<[name: string, link: LinkState, status: AdapterStatus, outcome: PlatformOutcome]> = [
    ["unlinked", unlinked, { state: "stopped" }, { status: "unavailable", reason: "not_linked" }],
    ["disabled", disabled, { state: "stopped" }, { status: "unavailable", reason: "disabled" }],
    ["stopped", linked, { state: "stopped" }, { status: "unavailable", reason: "stopped" }],
    ["parked", linked, { state: "parked", reason: "x" }, { status: "unavailable", reason: "parked" }],
  ];
  for (const [name, link, status, outcome] of rows) {
    test(`${name} answers at once`, async () => {
      const twitch = recording<"chat.send">();
      const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
      platforms.set("twitch", link, status);

      const reply = await send(request({ target: { kind: "platforms", ids: ["twitch"] } }));
      expect(reply).toEqual({ ok: false, results: { twitch: outcome } });
      expect(twitch.calls).toHaveLength(0);
    });
  }

  test("a starting adapter is waited for and answers once it connects", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, time, ask } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.set("twitch", linked, { state: "starting" });

    const replies = await ask(request({ target: { kind: "platforms", ids: ["twitch"] } }));
    await time.advance(1_000);
    expect(replies).toHaveLength(0);
    platforms.running("twitch");
    await flush();
    expect(only(replies)).toEqual({ ok: true, results: { twitch: delivered } });
  });

  test("a starting adapter that does not connect by the deadline is unavailable, starting", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, time, ask } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.set("twitch", linked, { state: "starting" });

    const replies = await ask(request({ target: { kind: "platforms", ids: ["twitch"] } }));
    await time.advance(DEADLINE_MS - 1);
    expect(replies).toHaveLength(0);
    await time.advance(1);
    expect(only(replies)).toEqual({ ok: false, results: { twitch: { status: "unavailable", reason: "starting" } } });
    expect(twitch.calls).toHaveLength(0);
  });
});

describe("PlatformGateway fan-out", () => {
  test("a slow platform does not delay a fast one", async () => {
    let finishSlow: (outcome: PlatformOutcome) => void = () => {};
    const slow = recording<"chat.send">(
      () =>
        new Promise<PlatformOutcome>((resolve) => {
          finishSlow = resolve;
        })
    );
    const fast = recording<"chat.send">();
    const { platforms, time, ask } = await setup([
      manifest("twitch", { "chat.send": slow.spec }),
      manifest(KICK, { "chat.send": fast.spec }),
    ]);
    platforms.running("twitch");
    platforms.running(KICK);

    const replies = await ask(request());
    await flush();
    expect(slow.calls).toHaveLength(1);
    expect(fast.calls).toHaveLength(1);
    await time.advance(3_000);
    expect(replies).toHaveLength(0);
    finishSlow({ status: "delivered", messageId: "m-2" });
    await flush();
    expect(only(replies).results).toEqual(
      results({ twitch: { status: "delivered", messageId: "m-2" }, kick: delivered })
    );
  });

  test("a platform that never answers is cut off at the deadline and the others still deliver", async () => {
    const hung = recording<"chat.send">(() => new Promise<PlatformOutcome>(() => {}));
    const fast = recording<"chat.send">();
    const { platforms, time, ask, logger } = await setup([
      manifest("twitch", { "chat.send": hung.spec }),
      manifest(KICK, { "chat.send": fast.spec }),
    ]);
    platforms.running("twitch");
    platforms.running(KICK);

    const replies = await ask(request());
    await time.advance(DEADLINE_MS);
    expect(only(replies)).toEqual({
      ok: true,
      results: results({
        twitch: { status: "failed", code: "upstream", message: "did not reach the platform before the deadline" },
        kick: delivered,
      }),
    });
    expect(logger.at("warn")).toHaveLength(0);
  });

  test("a deadline after markSent is unconfirmed", async () => {
    const twitch = recording<"chat.send">((ctx) => {
      ctx.markSent();
      return new Promise<PlatformOutcome>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const { platforms, time, ask } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const replies = await ask(request());
    await time.advance(DEADLINE_MS);
    const reply = only(replies);
    expect(reply.ok).toBe(false);
    expect(reply.results.twitch).toEqual({
      status: "unconfirmed",
      message: `twitch did not answer within ${DEADLINE_MS}ms; it may have acted`,
    });
  });

  test("a handler that throws is failed upstream", async () => {
    const twitch = recording<"chat.send">(async () => {
      throw new Error("helix exploded");
    });
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    expect((await send(request())).results.twitch).toEqual({
      status: "failed",
      code: "upstream",
      message: "helix exploded",
    });
  });

  test("a handler returning an outcome outside the contract is failed upstream", async () => {
    const twitch = recording<"chat.send">(async () => ({ status: "delivered!" }) as unknown as PlatformOutcome);
    const { platforms, send, logger } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    expect((await send(request())).results.twitch).toEqual({
      status: "failed",
      code: "upstream",
      message: "twitch returned an invalid outcome",
    });
    expect(logger.at("error").some((entry) => entry.message.includes("invalid outcome"))).toBe(true);
  });

  test("bad options fail only their own platform", async () => {
    const twitch = recording<"chat.send">(undefined, (raw) =>
      raw === "loud" ? parsed(raw) : parseFailed(`unknown style ${JSON.stringify(raw)}`)
    );
    const kick = recording<"chat.send">();
    const { platforms, send } = await setup([
      manifest("twitch", { "chat.send": twitch.spec }),
      manifest(KICK, { "chat.send": kick.spec }),
    ]);
    platforms.running("twitch");
    platforms.running(KICK);

    const reply = await send(request({ options: { twitch: "quiet" } }));
    expect(reply).toEqual({
      ok: true,
      results: results({
        twitch: { status: "failed", code: "invalid", message: 'options.twitch: unknown style "quiet"' },
        kick: delivered,
      }),
    });
    expect(twitch.calls).toHaveLength(0);

    await send(request({ options: { twitch: "loud" } }));
    expect(twitch.calls[0]?.options).toBe("loud");
  });

  test("options for a handler that takes none are refused for that platform", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    expect((await send(request({ options: { twitch: { color: "blue" } } }))).results.twitch).toEqual({
      status: "failed",
      code: "invalid",
      message: "options.twitch: twitch takes no options for chat.send",
    });
  });

  test("passes requestedBy, the deadline and workflowChain to the handler", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send, time } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");
    const sentAt = time.now();

    await send(request({ workflowChain: "workflow-a,workflow-b" }));
    const ctx = twitch.calls[0]?.ctx;
    expect(ctx?.workflowChain).toBe("workflow-a,workflow-b");
    expect(ctx?.requestedBy).toEqual({ kind: "workflow", ref: "workflow-1" });
    expect(ctx?.deadline).toBe(sentAt + DEADLINE_MS);

    await send(request());
    expect(twitch.calls[1]?.ctx.workflowChain).toBeUndefined();
  });

  test("counts outcomes per platform, action and status", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send, gateway } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const repeated = request();
    await send(repeated);
    await send(repeated);
    platforms.set("twitch", linked, { state: "stopped" });
    await send(request());

    expect(gateway.snapshot()).toEqual({
      outcomes: { twitch: { "chat.send": { delivered: 1, unavailable: 1 } } },
      idempotency: { replayed: 1, coalesced: 0, mismatched: 0, held: 2 },
    });
  });
});

describe("PlatformGateway idempotency", () => {
  test("a repeated key replays the first reply without a second call", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const repeated = request();
    const first = await send(repeated);
    platforms.set("twitch", linked, { state: "stopped" });
    expect(await send(repeated)).toEqual(first);
    expect(twitch.calls).toHaveLength(1);
  });

  test("the same key from another requester kind is a different request", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    await send(request({ idempotencyKey: "shared" }));
    await send(request({ idempotencyKey: "shared", requestedBy: { kind: "api", ref: "client-1" } }));
    expect(twitch.calls).toHaveLength(2);
  });

  test("a key reused for a different request is refused", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    await send(request({ idempotencyKey: "once" }));
    const reply = await send(request({ idempotencyKey: "once", payload: { message: "something else" } }));
    expect(reply).toEqual({
      ok: false,
      results: {},
      error: { code: "invalid", message: "idempotencyKey was already used for a different request" },
    });
    expect(twitch.calls).toHaveLength(1);
  });

  test("a repeat while the first is in flight waits for it instead of calling again", async () => {
    let finish: (outcome: PlatformOutcome) => void = () => {};
    const twitch = recording<"chat.send">(
      () =>
        new Promise<PlatformOutcome>((resolve) => {
          finish = resolve;
        })
    );
    const { platforms, ask, gateway } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const repeated = request();
    const first = await ask(repeated);
    const second = await ask(repeated);
    await flush();
    expect(twitch.calls).toHaveLength(1);
    finish(delivered);
    await flush();
    expect(only(first)).toEqual(only(second));
    expect(gateway.snapshot().idempotency.coalesced).toBe(1);
  });

  test("a key is forgotten after its TTL and runs again", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send, time } = await setup([manifest("twitch", { "chat.send": twitch.spec })], {
      woofx3ConnectorsGatewayIdempotencyTtlMs: 60_000,
    });
    platforms.running("twitch");

    const repeated = request();
    await send(repeated);
    await time.advance(59_999);
    await send(repeated);
    expect(twitch.calls).toHaveLength(1);
    await time.advance(1);
    await send(repeated);
    expect(twitch.calls).toHaveLength(2);
  });

  test("a refused target does not hold the key", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, send } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    await send(
      request({
        idempotencyKey: "retry-me",
        action: "chat.pin",
        payload: { messageId: "m" },
        target: { kind: "platforms", ids: ["twitch"] },
      })
    );
    expect((await send(request({ idempotencyKey: "retry-me" }))).ok).toBe(true);
  });
});

describe("PlatformGateway requests", () => {
  test("a publish with no reply inbox is ignored", async () => {
    const twitch = recording<"chat.send">();
    const { platforms, bus, requests } = await setup([manifest("twitch", { "chat.send": twitch.spec })]);
    platforms.running("twitch");

    const replies = bus.deliver(SEND, bytes(JSON.stringify(request())));
    await flush();
    expect(replies).toHaveLength(0);
    expect(twitch.calls).toHaveLength(0);
    expect(requests.snapshot()[SEND]?.no_inbox).toBe(1);
  });

  const invalid: Array<[name: string, body: string, message: string]> = [
    ["not JSON", "{", "request is not JSON"],
    ["a payload over its bound", JSON.stringify(request({ payload: { message: "x".repeat(501) } })), "payload.message"],
    ["an unknown field", JSON.stringify(request({ priority: 1 })), "priority: unknown field"],
    ["no idempotency key", JSON.stringify(request({ idempotencyKey: "" })), "idempotencyKey: is required"],
  ];
  for (const [name, body, message] of invalid) {
    test(`refuses ${name} as invalid`, async () => {
      const { bus } = await setup([]);
      const replies = bus.deliver(SEND, bytes(body), "inbox");
      await flush();
      const reply = only(replies);
      expect(reply.ok).toBe(false);
      expect(reply.results).toEqual({});
      expect(reply.error?.code).toBe("invalid");
      expect(reply.error?.message).toContain(message);
    });
  }
});
