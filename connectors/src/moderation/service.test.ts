import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EXEMPTIONS,
  FILTER_IDS,
  type FilterId,
  MODERATION_SUBJECTS,
  type ModerationAction,
  type ModerationActionTaken,
  type ModerationConfig,
  type ModerationRule,
} from "@woofx3/api/moderation-config";
import {
  type GatewayReply,
  type GatewayRequest,
  PLATFORM_GATEWAY_REPLY_TYPES,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformOutcome,
} from "@woofx3/api/platform-gateway";
import { chatLine } from "../chat/testing";
import type { ChatLine } from "../chat/trust";
import { RecordingLogger } from "../host/testing";
import { MODERATION_TUNABLES } from "./defaults";
import { filterRegistry } from "./registry";
import { MODERATION_REQUESTER_REF, type ModerationLineOutcome, ModerationService } from "./service";
import { filterEnv, NOBODY, PLATFORM, stubFilter } from "./testing";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The gateway as moderation sees it: answers each request by its action, recording it. */
class FakeGateway {
  readonly requests: GatewayRequest[] = [];
  readonly published: Array<{ subject: string; event: { type: string; data: ModerationActionTaken } }> = [];
  answers: Partial<Record<GatewayRequest["action"], PlatformOutcome | Error>> = {};

  readonly bus = {
    request: async (subject: string, data: Uint8Array) => {
      expect(subject).toBe(PLATFORM_GATEWAY_SUBJECTS.send);
      const request = JSON.parse(decoder.decode(data)) as GatewayRequest;
      this.requests.push(request);
      const answer = this.answers[request.action] ?? { status: "delivered" };
      if (answer instanceof Error) {
        throw answer;
      }
      const reply: GatewayReply = { ok: answer.status === "delivered", results: { [PLATFORM]: answer } };
      return {
        subject,
        data: encoder.encode(JSON.stringify({ type: PLATFORM_GATEWAY_REPLY_TYPES.send, data: reply })),
      };
    },
    publish: async (subject: string, data: Uint8Array) => {
      this.published.push({ subject, event: JSON.parse(decoder.decode(data)) });
    },
  };

  get steps(): ModerationActionTaken["steps"][] {
    return this.published.map((entry) => entry.event.data.steps);
  }
}

function rule(actions: ModerationAction[], overrides: Partial<ModerationRule> = {}): ModerationRule {
  return { enabled: true, actions, params: {}, ...overrides };
}

function setup(rules: Partial<Record<FilterId, ModerationRule>>, overrides: Partial<ModerationConfig> = {}) {
  let config: ModerationConfig = {
    version: 1,
    enabled: true,
    dryRun: false,
    exempt: DEFAULT_EXEMPTIONS,
    rules,
    ...overrides,
  };
  const gateway = new FakeGateway();
  const logger = new RecordingLogger();
  let now = 1_000_000;
  const clock = { now: () => now };
  // Every filter hits, so the first enabled rule in FILTER_IDS order is the one that acts.
  const registry = filterRegistry(FILTER_IDS.map((id) => stubFilter(id, () => ({ hit: true, reason: `${id} hit` }))));
  const service = new ModerationService({
    config: { current: () => config },
    registry,
    env: filterEnv({ clock }),
    bus: gateway.bus,
    clock,
    logger,
    tunables: MODERATION_TUNABLES,
    gatewayTimeoutMs: 1_000,
  });
  return {
    service,
    gateway,
    logger,
    advance: (ms: number) => {
      now += ms;
    },
    reconfigure: (next: ModerationConfig) => {
      config = next;
    },
  };
}

const viewerLine = (overrides: Partial<ChatLine> = {}): ChatLine =>
  chatLine({ text: "BUY FOLLOWERS AT example.com", messageId: "m-7", lineId: "m-7", ...overrides });

describe("ModerationService, lines it never moderates", () => {
  const skipped: Array<[name: string, line: ChatLine, outcome: ModerationLineOutcome]> = [
    [
      "an untrusted line",
      viewerLine({ trusted: false, membership: undefined, messageId: undefined }),
      "not_moderatable",
    ],
    ["a partner channel's line in shared chat", viewerLine({ sharedChat: true }), "not_moderatable"],
    ["a line without the platform's message id", viewerLine({ messageId: undefined }), "not_moderatable"],
  ];
  for (const [name, line, outcome] of skipped) {
    test(name, async () => {
      const { service, gateway } = setup({ links: rule([{ kind: "delete" }]) });
      expect(await service.handle(line)).toBe(outcome);
      expect(gateway.requests).toHaveLength(0);
      expect(gateway.published).toHaveLength(0);
    });
  }

  test("any line while the master switch is off", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }]) }, { enabled: false });
    expect(await service.handle(viewerLine())).toBe("off");
    expect(gateway.requests).toHaveLength(0);
  });

  test("the broadcaster's line, whatever the rules", async () => {
    const { service, gateway } = setup(
      { links: rule([{ kind: "ban" }], { exempt: { moderators: false } }) },
      { exempt: { ...DEFAULT_EXEMPTIONS, moderators: false, vips: false, subscribers: false } }
    );
    const line = viewerLine({ membership: { ...NOBODY, isBroadcaster: true } });
    expect(await service.handle(line)).toBe("passed");
    expect(gateway.requests).toHaveLength(0);
  });
});

describe("ModerationService, actions", () => {
  const byAction: Array<[action: ModerationAction, expected: Pick<GatewayRequest, "action" | "payload">]> = [
    [{ kind: "delete" }, { action: "chat.delete", payload: { messageId: "m-7" } }],
    [
      { kind: "warn", reason: "No links, please." },
      { action: "moderation.warn", payload: { viewer: "v-1", reason: "No links, please." } },
    ],
    [
      { kind: "timeout", durationSeconds: 600 },
      { action: "moderation.timeout", payload: { viewer: "v-1", durationSeconds: 600, reason: "links hit" } },
    ],
    [{ kind: "ban" }, { action: "moderation.ban", payload: { viewer: "v-1", reason: "links hit" } }],
  ];
  for (const filter of FILTER_IDS) {
    for (const [action, expected] of byAction) {
      test(`${filter} with ${action.kind} sends ${expected.action} to the line's own platform`, async () => {
        const { service, gateway } = setup({ [filter]: rule([action]) });
        expect(await service.handle(viewerLine())).toBe("moderated");
        expect(gateway.requests).toEqual([
          {
            ...expected,
            payload:
              "reason" in expected.payload && action.kind !== "warn"
                ? { ...expected.payload, reason: `${filter} hit` }
                : expected.payload,
            target: { kind: "origin", origin: { platform: PLATFORM, messageId: "m-7" } },
            idempotencyKey: `moderation:m-7:${action.kind}`,
            requestedBy: { kind: "dispatcher", ref: MODERATION_REQUESTER_REF },
          } as GatewayRequest,
        ]);
        expect(gateway.steps).toEqual([[{ kind: action.kind, outcome: "done" }]]);
      });
    }
  }

  test("a failed warn does not stop the delete before it or the timeout after it", async () => {
    const { service, gateway } = setup({
      links: rule([{ kind: "delete" }, { kind: "warn", reason: "stop" }, { kind: "timeout", durationSeconds: 60 }]),
    });
    gateway.answers["moderation.warn"] = { status: "failed", code: "forbidden", message: "missing scope" };
    await service.handle(viewerLine());
    expect(gateway.requests.map((request) => request.action)).toEqual([
      "chat.delete",
      "moderation.warn",
      "moderation.timeout",
    ]);
    expect(gateway.steps).toEqual([
      [
        { kind: "delete", outcome: "done" },
        { kind: "warn", outcome: "failed:forbidden" },
        { kind: "timeout", outcome: "done" },
      ],
    ]);
  });

  test("records an action the platform does not support, and still runs the others", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }, { kind: "warn", reason: "stop" }]) });
    gateway.answers["moderation.warn"] = { status: "unsupported" };
    await service.handle(viewerLine());
    expect(gateway.steps).toEqual([
      [
        { kind: "delete", outcome: "done" },
        { kind: "warn", outcome: "failed:unsupported" },
      ],
    ]);
  });

  test("records a gateway that never answered as upstream", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }]) });
    gateway.answers["chat.delete"] = new Error("request timed out");
    await service.handle(viewerLine());
    expect(gateway.steps).toEqual([[{ kind: "delete", outcome: "failed:upstream" }]]);
  });

  test("a line delivered twice is sent with the same idempotency keys, and warned once", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }, { kind: "warn", reason: "stop" }]) });
    await service.handle(viewerLine());
    await service.handle(viewerLine());
    expect(gateway.requests.map((request) => request.idempotencyKey)).toEqual([
      "moderation:m-7:delete",
      "moderation:m-7:warn",
      "moderation:m-7:delete",
    ]);
    expect(gateway.steps[1]).toEqual([
      { kind: "delete", outcome: "done" },
      { kind: "warn", outcome: "skipped:cooldown" },
    ]);
  });

  test("warns a chatter again once the cooldown has passed", async () => {
    const { service, gateway, advance } = setup({ links: rule([{ kind: "warn", reason: "stop" }]) });
    await service.handle(viewerLine({ messageId: "m-1" }));
    advance(MODERATION_TUNABLES.warnCooldownSeconds * 1_000);
    await service.handle(viewerLine({ messageId: "m-2" }));
    expect(gateway.steps.map((steps) => steps[0]?.outcome)).toEqual(["done", "done"]);
  });

  test("drops a warn when the platform is already refusing writes as rate limited", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }, { kind: "warn", reason: "stop" }]) });
    gateway.answers["chat.delete"] = { status: "failed", code: "rate_limited", message: "queue full" };
    await service.handle(viewerLine());
    expect(gateway.steps).toEqual([
      [
        { kind: "delete", outcome: "failed:rate_limited" },
        { kind: "warn", outcome: "skipped:busy" },
      ],
    ]);
  });

  const protectedRoles: Array<[name: string, line: ChatLine]> = [
    ["a moderator", viewerLine({ membership: { ...NOBODY, isModerator: true } })],
    ["a VIP", viewerLine({ membership: { ...NOBODY, isVip: true } })],
    ["a chatter of unknown role", viewerLine({ membership: undefined })],
  ];
  for (const [name, line] of protectedRoles) {
    test(`never times out or bans ${name}, even when the exemptions would let it`, async () => {
      const noExemptions = { ...DEFAULT_EXEMPTIONS, moderators: false, vips: false, subscribers: false };
      for (const punishment of [{ kind: "timeout", durationSeconds: 60 }, { kind: "ban" }] as const) {
        const { service, gateway } = setup({ links: rule([{ kind: "delete" }, punishment]) }, { exempt: noExemptions });
        await service.handle(line);
        expect(gateway.requests.map((request) => request.action)).toEqual(["chat.delete"]);
        expect(gateway.steps).toEqual([
          [
            { kind: "delete", outcome: "done" },
            { kind: punishment.kind, outcome: "skipped:protected" },
          ],
        ]);
      }
    });
  }

  test("a dry run evaluates and records, but sends nothing", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }, { kind: "ban" }]) }, { dryRun: true });
    expect(await service.handle(viewerLine())).toBe("moderated");
    expect(gateway.requests).toHaveLength(0);
    expect(gateway.published[0]?.event.data).toMatchObject({
      dryRun: true,
      steps: [
        { kind: "delete", outcome: "skipped:dry_run" },
        { kind: "ban", outcome: "skipped:dry_run" },
      ],
    });
  });

  test("logs a forbidden step once until it succeeds again", async () => {
    const { service, gateway, logger, advance } = setup({ links: rule([{ kind: "warn", reason: "stop" }]) });
    gateway.answers["moderation.warn"] = { status: "failed", code: "forbidden", message: "missing scope" };
    const forbiddenLogs = () => logger.entries.filter((entry) => entry.message.includes("forbidden")).length;
    for (const messageId of ["m-1", "m-2"]) {
      advance(MODERATION_TUNABLES.warnCooldownSeconds * 1_000);
      await service.handle(viewerLine({ messageId }));
    }
    expect(forbiddenLogs()).toBe(1);
    delete gateway.answers["moderation.warn"];
    advance(MODERATION_TUNABLES.warnCooldownSeconds * 1_000);
    await service.handle(viewerLine({ messageId: "m-3" }));
    gateway.answers["moderation.warn"] = { status: "failed", code: "forbidden", message: "missing scope" };
    advance(MODERATION_TUNABLES.warnCooldownSeconds * 1_000);
    await service.handle(viewerLine({ messageId: "m-4" }));
    expect(forbiddenLogs()).toBe(2);
  });

  test("records the hit as moderation.action.taken, with the line cut short", async () => {
    const { service, gateway } = setup({ links: rule([{ kind: "delete" }]) });
    await service.handle(viewerLine({ text: "x".repeat(500) }));
    expect(gateway.published).toHaveLength(1);
    const [published] = gateway.published;
    expect(published?.subject).toBe(MODERATION_SUBJECTS.actionTaken);
    expect(published?.event.type).toBe(MODERATION_SUBJECTS.actionTaken);
    expect(published?.event.data).toEqual({
      platform: PLATFORM,
      viewer: "v-1",
      chatterLogin: "viewer",
      messageId: "m-7",
      filter: "links",
      reason: "links hit",
      text: "x".repeat(MODERATION_TUNABLES.recordedTextChars),
      dryRun: false,
      steps: [{ kind: "delete", outcome: "done" }],
    });
  });

  test("uses the config as it was when the line arrived", async () => {
    const { service, gateway, reconfigure } = setup({ links: rule([{ kind: "delete" }, { kind: "ban" }]) });
    const handled = service.handle(viewerLine());
    reconfigure({ version: 1, enabled: false, dryRun: false, exempt: DEFAULT_EXEMPTIONS, rules: {} });
    await handled;
    expect(gateway.requests.map((request) => request.action)).toEqual(["chat.delete", "moderation.ban"]);
  });
});
