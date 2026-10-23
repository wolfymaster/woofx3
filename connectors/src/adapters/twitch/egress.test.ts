import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import {
  type EgressActionId,
  type EgressPayloads,
  type FailureCode,
  type GatewayReply,
  PLATFORM_GATEWAY_SUBJECTS,
  PLATFORM_IDS,
  type PlatformOutcome,
  parseGatewayReply,
} from "@woofx3/api/platform-gateway";
import type { HelixCommandArgs, HelixCommandResult } from "@woofx3/common/cloudevents/Twitch/commands";
import { GatewayEnvSchema, gatewayConfig } from "../../config/gateway";
import { EgressRegistry } from "../../gateway/egress-registry";
import { type GatewayAdapters, PlatformGateway } from "../../gateway/platform-gateway";
import type { AdapterManifest, AdapterStatus, EgressContext, EgressHandlerSpec } from "../../host/adapter";
import type { AdapterId } from "../../host/adapter-ids";
import { HostRequests } from "../../host/host-requests";
import type { LinkState } from "../../host/link-readers";
import { ScopeCounters, ScopedBus } from "../../host/scoped-bus";
import {
  bytes,
  countingIds,
  FakeBus,
  FakeTime,
  flush,
  linked,
  RecordingLogger,
  text,
  unlinked,
} from "../../host/testing";
import {
  ANNOUNCEMENT_COLORS,
  type AnnounceOptions,
  helixFailureCode,
  parseAnnounceOptions,
  type TwitchEgressSession,
  twitchEgress,
} from "./egress";
import { HELIX_DEADLINE_MS, type HelixAuth, HelixNoAnswer, runHelixOperation } from "./lib/helix";
import { SendQueue } from "./lib/send-queue";
import type { TwitchApiCall } from "./lib/twitch";
import { TwitchApiError } from "./lib/twitchApiError";

/** What a fake Helix call does: answer with a result, or throw. */
type HelixAnswer = HelixCommandResult | Error;

interface HelixCall {
  args: HelixCommandArgs;
  call: TwitchApiCall;
}

/** A session whose Helix calls answer with `answers` in turn, recording each call. */
function scriptedSession(...answers: HelixAnswer[]) {
  const calls: HelixCall[] = [];
  const session: TwitchEgressSession = {
    kind: "ready",
    helix: async (args, call) => {
      calls.push({ args, call });
      const answer = answers[calls.length - 1];
      if (answer === undefined) {
        throw new Error("scriptedSession: more Helix calls than answers");
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
  return { session, calls };
}

const NOW = 1_000_000;

function context(remainingMs = 9_000) {
  const controller = new AbortController();
  let marks = 0;
  const ctx: EgressContext = {
    signal: controller.signal,
    deadline: NOW + remainingMs,
    requestedBy: { kind: "workflow", ref: "workflow-1" },
    markSent: () => {
      marks++;
    },
  };
  return { ctx, controller, marks: () => marks };
}

function handlers(session: TwitchEgressSession, queue = new SendQueue(10)) {
  return twitchEgress({ session: () => session, queue, clock: { now: () => NOW } });
}

/** Runs `action` once with `payload` and `options`, the way the gateway calls a handler. */
async function perform<A extends EgressActionId>(
  session: TwitchEgressSession,
  action: A,
  payload: EgressPayloads[A],
  options?: unknown,
  ctx: EgressContext = context().ctx
): Promise<PlatformOutcome> {
  const spec = handlers(session)[action] as EgressHandlerSpec<A> | undefined;
  if (spec === undefined) {
    throw new Error(`no handler for ${action}`);
  }
  return spec.handle(payload, options, ctx);
}

const posted = (messageId: string): HelixCommandResult => ({
  ok: true,
  body: { data: [{ message_id: messageId, is_sent: true }] },
});
const noContent: HelixCommandResult = { ok: true, body: null };
const refused = (status: number, message = "nope"): HelixCommandResult => ({
  ok: false,
  status,
  body: JSON.stringify({ error: "Error", status, message }),
});

/** One payload per action, each answered by a single Helix write. */
const SINGLE_WRITE_ACTIONS: Array<[action: EgressActionId, payload: EgressPayloads[EgressActionId]]> = [
  ["chat.send", { message: "hello chat" }],
  ["chat.announce", { message: "giveaway at 9" }],
  ["chat.pin", { messageId: "m-9" }],
];

/** How every action maps a Helix answer it cannot use, whichever action it was. */
const FAILURES: Array<[name: string, answer: HelixAnswer, outcome: PlatformOutcome]> = [
  ["400", refused(400, "bad color"), { status: "failed", code: "invalid", message: "Twitch answered 400: bad color" }],
  ["422", refused(422), { status: "failed", code: "invalid", message: "Twitch answered 422: nope" }],
  ["401", refused(401), { status: "failed", code: "forbidden", message: "Twitch answered 401: nope" }],
  ["403", refused(403), { status: "failed", code: "forbidden", message: "Twitch answered 403: nope" }],
  ["429", refused(429), { status: "failed", code: "rate_limited", message: "Twitch answered 429: nope" }],
  ["500", refused(500), { status: "failed", code: "upstream", message: "Twitch answered 500: nope" }],
  [
    "503 with a body that is not JSON",
    { ok: false, status: 503, body: "<html>" },
    { status: "failed", code: "upstream", message: "Twitch answered 503" },
  ],
  [
    "no answer after the request left",
    new HelixNoAnswer("helix x: the caller stopped waiting; Twitch may still have acted", true, {}),
    { status: "unconfirmed", message: "helix x: the caller stopped waiting; Twitch may still have acted" },
  ],
  [
    "no answer before the request left",
    new HelixNoAnswer("helix x: no answer within 8s, before a request was sent", false, {}),
    { status: "failed", code: "upstream", message: "did not reach Twitch before the deadline" },
  ],
  [
    "a request refused before sending",
    new TwitchApiError("invalid_arguments", "helix x: unknown parameter"),
    { status: "failed", code: "invalid", message: "helix x: unknown parameter" },
  ],
  [
    "any other error",
    new Error("there is no Twitch token for the broadcaster"),
    { status: "failed", code: "upstream", message: "there is no Twitch token for the broadcaster" },
  ],
];

describe("twitch egress, action by Helix answer", () => {
  for (const [action, payload] of SINGLE_WRITE_ACTIONS) {
    for (const [name, answer, outcome] of FAILURES) {
      test(`${action}: ${name}`, async () => {
        const { session } = scriptedSession(answer);
        expect(await perform(session, action, payload)).toEqual(outcome);
      });
    }
  }

  const successes: Array<
    [name: string, action: EgressActionId, payload: unknown, answer: HelixAnswer, outcome: PlatformOutcome]
  > = [
    ["chat.send posted", "chat.send", { message: "hi" }, posted("m-1"), { status: "delivered", messageId: "m-1" }],
    [
      "chat.send dropped by Twitch",
      "chat.send",
      { message: "hi" },
      {
        ok: true,
        body: { data: [{ message_id: "", is_sent: false, drop_reason: { code: "c", message: "AutoMod" } }] },
      },
      { status: "dropped", reason: "AutoMod" },
    ],
    [
      "chat.send with an answer that cannot be read",
      "chat.send",
      { message: "hi" },
      { ok: true, body: { data: [] } },
      { status: "unconfirmed", message: "Twitch accepted the line but its answer could not be read" },
    ],
    ["chat.announce answered 204", "chat.announce", { message: "hi" }, noContent, { status: "delivered" }],
    [
      "chat.pin of an existing line",
      "chat.pin",
      { messageId: "m-9" },
      noContent,
      { status: "delivered", messageId: "m-9" },
    ],
  ];
  for (const [name, action, payload, answer, outcome] of successes) {
    test(name, async () => {
      const { session } = scriptedSession(answer);
      expect(await perform(session, action, payload as EgressPayloads[typeof action])).toEqual(outcome);
    });
  }
});

describe("twitch egress, Helix requests", () => {
  test("chat.send says the line as the broadcaster, as a reply when asked", async () => {
    const { session, calls } = scriptedSession(posted("m-1"), posted("m-2"));

    await perform(session, "chat.send", { message: "hi" });
    await perform(session, "chat.send", { message: "same", replyToMessageId: "parent-1" });
    expect(calls.map((call) => call.args)).toEqual([
      { operation: "sendChatMessage", params: { message: "hi" } },
      { operation: "sendChatMessage", params: { message: "same", reply_parent_message_id: "parent-1" } },
    ]);
  });

  test("chat.announce uses the primary colour unless the options name one", async () => {
    const { session, calls } = scriptedSession(noContent, noContent);

    await perform(session, "chat.announce", { message: "a" });
    await perform(session, "chat.announce", { message: "b" }, { color: "purple" } satisfies AnnounceOptions);
    expect(calls.map((call) => call.args.params)).toEqual([
      { message: "a", color: "primary" },
      { message: "b", color: "purple" },
    ]);
  });

  test("bounds each call by the request's deadline and HELIX_DEADLINE_MS, and marks it sent through onSent", async () => {
    const { session, calls } = scriptedSession(posted("m-1"), posted("m-2"));
    const roomy = context(9_000);
    const tight = context(1_500);

    await perform(session, "chat.send", { message: "a" }, undefined, roomy.ctx);
    await perform(session, "chat.send", { message: "b" }, undefined, tight.ctx);
    expect(calls.map((call) => call.call.helixDeadlineMs)).toEqual([HELIX_DEADLINE_MS, 1_500]);
    expect(calls[0]?.call.signal).toBe(roomy.ctx.signal);

    calls[0]?.call.onSent?.();
    expect(roomy.marks()).toBe(1);
  });

  test("answers unavailable without a Helix call while the adapter is stopped or reconnecting", async () => {
    for (const reason of ["stopped", "starting"] as const) {
      expect(await perform({ kind: "unavailable", reason }, "chat.send", { message: "hi" })).toEqual({
        status: "unavailable",
        reason,
      });
    }
  });
});

describe("twitch egress, chat.pin of a new line", () => {
  test("posts the line, then pins it for the asked duration", async () => {
    const { session, calls } = scriptedSession(posted("m-1"), noContent);

    expect(await perform(session, "chat.pin", { message: "pin me", durationSeconds: 120 })).toEqual({
      status: "delivered",
      messageId: "m-1",
    });
    expect(calls.map((call) => call.args)).toEqual([
      { operation: "sendChatMessage", params: { message: "pin me" } },
      { operation: "pinChatMessage", params: { message_id: "m-1", duration: 120 } },
    ]);
  });

  test("pins without a duration when none is asked", async () => {
    const { session, calls } = scriptedSession(posted("m-1"), noContent);

    await perform(session, "chat.pin", { message: "pin me" });
    expect(calls[1]?.args).toEqual({ operation: "pinChatMessage", params: { message_id: "m-1" } });
  });

  const partial: Array<[name: string, pinAnswer: HelixAnswer, outcome: PlatformOutcome]> = [
    [
      "a refused pin",
      refused(403, "missing scope"),
      {
        status: "failed",
        code: "forbidden",
        message: "posted but not pinned: Twitch answered 403: missing scope",
        messageId: "m-1",
      },
    ],
    [
      "a pin with no answer",
      new HelixNoAnswer("helix pinChatMessage: no answer within 8s; Twitch may still have acted", true, {}),
      {
        status: "failed",
        code: "upstream",
        message: "posted but not pinned: helix pinChatMessage: no answer within 8s; Twitch may still have acted",
        messageId: "m-1",
      },
    ],
  ];
  for (const [name, pinAnswer, outcome] of partial) {
    test(`reports ${name} as a failure that keeps the posted line's id`, async () => {
      const { session } = scriptedSession(posted("m-1"), pinAnswer);
      expect(await perform(session, "chat.pin", { message: "pin me" })).toEqual(outcome);
    });
  }

  test("holds part of the deadline back from the pin so the reply can still carry the posted id", async () => {
    const { session, calls } = scriptedSession(posted("m-1"), noContent);

    await perform(session, "chat.pin", { message: "pin me" }, undefined, context(1_000).ctx);
    expect(calls.map((call) => call.call.helixDeadlineMs)).toEqual([1_000, 750]);
  });

  test("does not call Twitch to pin when the post left no time for it", async () => {
    const { session, calls } = scriptedSession(posted("m-1"));

    expect(await perform(session, "chat.pin", { message: "pin me" }, undefined, context(200).ctx)).toEqual({
      status: "failed",
      code: "upstream",
      message: "posted but not pinned: did not reach Twitch before the deadline",
      messageId: "m-1",
    });
    expect(calls).toHaveLength(1);
  });

  test("does not pin a line Twitch dropped", async () => {
    const dropped: HelixCommandResult = { ok: true, body: { data: [{ is_sent: false, drop_reason: { code: "x" } }] } };
    const { session, calls } = scriptedSession(dropped);

    expect(await perform(session, "chat.pin", { message: "pin me" })).toEqual({ status: "dropped", reason: "x" });
    expect(calls).toHaveLength(1);
  });

  test("reports a post that failed as that failure, without a pin", async () => {
    const { session, calls } = scriptedSession(refused(429));

    expect(await perform(session, "chat.pin", { message: "pin me" })).toEqual({
      status: "failed",
      code: "rate_limited",
      message: "Twitch answered 429: nope",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("twitch egress, send queue", () => {
  test("refuses a write as rate limited when the queue is full", async () => {
    let release!: (result: HelixCommandResult) => void;
    const session: TwitchEgressSession = {
      kind: "ready",
      helix: () =>
        new Promise<HelixCommandResult>((resolve) => {
          release = resolve;
        }),
    };
    const send = handlers(session, new SendQueue(0))["chat.send"];

    const first = send?.handle({ message: "a" }, undefined, context().ctx);
    expect(await send?.handle({ message: "b" }, undefined, context().ctx)).toEqual({
      status: "failed",
      code: "rate_limited",
      message: "too many Twitch chat writes are waiting; try again shortly",
    });
    release(posted("m-1"));
    expect(await first).toEqual({ status: "delivered", messageId: "m-1" });
  });

  test("reports a write whose deadline passed while it waited as never sent", async () => {
    let release!: (result: HelixCommandResult) => void;
    const calls: HelixCommandArgs[] = [];
    const session: TwitchEgressSession = {
      kind: "ready",
      helix: (args) => {
        calls.push(args);
        return new Promise<HelixCommandResult>((resolve) => {
          release = resolve;
        });
      },
    };
    const send = handlers(session)["chat.send"];
    const waiting = context();

    const first = send?.handle({ message: "a" }, undefined, context().ctx);
    const second = send?.handle({ message: "b" }, undefined, waiting.ctx);
    waiting.controller.abort(new Error("deadline"));
    expect(await second).toEqual({
      status: "failed",
      code: "upstream",
      message: "did not reach Twitch before the deadline",
    });
    release(posted("m-1"));
    await first;
    expect(calls).toHaveLength(1);
    expect(waiting.marks()).toBe(0);
  });
});

describe("parseAnnounceOptions", () => {
  test("takes each Twitch colour", () => {
    for (const color of ANNOUNCEMENT_COLORS) {
      expect(parseAnnounceOptions({ color })).toEqual({ ok: true, value: { color } });
    }
  });

  test("reads an absent colour as primary", () => {
    expect(parseAnnounceOptions({})).toEqual({ ok: true, value: { color: "primary" } });
  });

  const refusals: Array<[name: string, raw: unknown, error: string]> = [
    ["an unknown colour", { color: "red" }, "color must be one of primary, blue, green, orange, purple"],
    ["a colour of the wrong case", { color: "Blue" }, "color must be one of primary, blue, green, orange, purple"],
    ["a colour that is not text", { color: 3 }, "color must be one of primary, blue, green, orange, purple"],
    ["an unknown option", { colour: "blue" }, 'unknown option "colour"'],
    ["a bare string", "blue", "must be an object"],
    ["null", null, "must be an object"],
    ["a list", ["blue"], "must be an object"],
  ];
  for (const [name, raw, error] of refusals) {
    test(`refuses ${name}`, () => {
      expect(parseAnnounceOptions(raw)).toEqual({ ok: false, error });
    });
  }
});

describe("helixFailureCode", () => {
  const rows: Array<[status: number, code: FailureCode]> = [
    [400, "invalid"],
    [422, "invalid"],
    [401, "forbidden"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [404, "upstream"],
    [500, "upstream"],
    [503, "upstream"],
  ];
  for (const [status, code] of rows) {
    test(`${status} is ${code}`, () => {
      expect(helixFailureCode(status)).toBe(code);
    });
  }
});

describe("twitch egress through the platform gateway", () => {
  const BROADCASTER_ID = "broadcaster-1";
  let fetchSpy: Mock<typeof fetch>;
  const sent: unknown[] = [];

  beforeEach(() => {
    sent.length = 0;
    fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation((async (_input: string | URL | Request, init?: RequestInit) => {
      sent.push(init?.body == null ? undefined : JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: [{ message_id: "m-1", is_sent: true }] }), { status: 200 });
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const auth: HelixAuth = {
    clientId: "client-1",
    getAccessTokenForUser: async () => ({
      accessToken: "token-1",
      refreshToken: null,
      scope: [],
      expiresIn: null,
      obtainmentTimestamp: 0,
      userId: BROADCASTER_ID,
    }),
  };

  /** The gateway with the Twitch egress over real Helix requests, answered by a stubbed fetch. */
  async function gatewayWithTwitch(link: LinkState, status: AdapterStatus) {
    const time = new FakeTime();
    const bus = new FakeBus();
    const logger = new RecordingLogger();
    const session: TwitchEgressSession = {
      kind: "ready",
      helix: (args, call) =>
        runHelixOperation(auth, BROADCASTER_ID, args, {
          deadlineMs: call.helixDeadlineMs,
          signal: call.signal,
          onSent: call.onSent,
        }),
    };
    const manifest: AdapterManifest = {
      id: "twitch" as AdapterId,
      publishes: [],
      subscribes: [],
      requests: [],
      serves: [],
      egress: twitchEgress({ session: () => session, queue: new SendQueue(10), clock: time }),
    };
    const adapters: GatewayAdapters = {
      status: () => status,
      link: () => link,
      onStatusChange: () => () => {},
    };
    const requests = new HostRequests({ clock: time, ids: countingIds(), timers: time, logger });
    const scope = new ScopedBus({
      scope: "host",
      client: bus,
      grants: { publishes: [], subscribes: Object.values(PLATFORM_GATEWAY_SUBJECTS), requests: [] },
      limits: { concurrency: 16, queueCap: 16 },
      logger,
      counters: new ScopeCounters(),
      clock: time,
    });
    const gateway = new PlatformGateway({
      config: gatewayConfig(GatewayEnvSchema.parse({})),
      egress: EgressRegistry.fromManifests([manifest], PLATFORM_IDS),
      adapters,
      requests,
      clock: time,
      logger,
    });
    await gateway.serve(scope);
    return async (request: Record<string, unknown>): Promise<GatewayReply> => {
      const replies = bus.deliver(PLATFORM_GATEWAY_SUBJECTS.send, bytes(JSON.stringify(request)), "inbox");
      for (let i = 0; i < 20 && replies.length === 0; i++) {
        await flush();
      }
      expect(replies).toHaveLength(1);
      const reply = parseGatewayReply((JSON.parse(text(replies[0] as Uint8Array)) as { data: unknown }).data);
      if (!reply.ok) {
        throw new Error(`reply does not parse: ${reply.error.field} ${reply.error.problem}`);
      }
      return reply.value;
    };
  }

  const hello = (message: string) => ({
    action: "chat.send",
    target: { kind: "platforms", ids: ["twitch"] },
    payload: { message },
    idempotencyKey: `key-${message}`,
    requestedBy: { kind: "workflow", ref: "workflow-1" },
  });

  test("posts a guarded command line and replies delivered with its message id", async () => {
    const send = await gatewayWithTwitch(linked, { state: "connected", since: 0 });

    expect(await send(hello("!hi"))).toEqual({
      ok: true,
      results: { twitch: { status: "delivered", messageId: "m-1" } },
    });
    expect(sent).toEqual([{ broadcaster_id: BROADCASTER_ID, sender_id: BROADCASTER_ID, message: "​!hi" }]);
  });

  test("replies unavailable, not linked, once Twitch is unlinked, without calling Twitch", async () => {
    const send = await gatewayWithTwitch(unlinked, { state: "stopped" });

    expect(await send(hello("hi"))).toEqual({
      ok: false,
      results: { twitch: { status: "unavailable", reason: "not_linked" } },
    });
    expect(sent).toEqual([]);
  });
});
