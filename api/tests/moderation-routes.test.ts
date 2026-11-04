import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MODERATION_CONFIG,
  MODERATION_CONFIG_SETTING_KEY,
  MODERATION_SUBJECTS,
  type ModerationActionRecord,
  type ModerationActionTaken,
  type ModerationConfig,
} from "@woofx3/api/moderation-config";
import type * as user_event from "@woofx3/db/user_event.pb";
import { moderationRoutes } from "../src/routes/moderation";

const CONFIG: ModerationConfig = {
  ...DEFAULT_MODERATION_CONFIG,
  enabled: true,
  rules: {
    links: {
      enabled: true,
      actions: [{ kind: "delete" }, { kind: "warn", reason: "No links, please." }],
      params: { allowDomains: ["example.tv"], permitSeconds: 60 },
    },
  },
};

const ACTION: ModerationActionTaken = {
  platform: "twitch",
  viewer: "v-1",
  chatterLogin: "viewer_one",
  messageId: "m-1",
  filter: "links",
  reason: "posted a link to a website not on the list",
  text: "go to evil.com",
  dryRun: false,
  steps: [{ kind: "delete", outcome: "done" }],
};

function logged(data: unknown, eventId = "ce-1"): user_event.UserEvent {
  return {
    id: "7f0c5a1e-0000-4000-8000-000000000001",
    eventId,
    source: "connectors.moderation",
    eventType: MODERATION_SUBJECTS.actionTaken,
    platform: "twitch",
    eventValue: JSON.stringify(data),
    occurredAt: { seconds: 1_790_000_000n, nanos: 0 },
    createdAt: { seconds: 1_790_000_000n, nanos: 0 },
  };
}

/** The routes touch `db`, `publishEvent` and `logger`, so that is all the host has. */
function setup(stored: string | null = null, events: user_event.UserEvent[] = []) {
  const settings = new Map<string, string>();
  if (stored !== null) {
    settings.set(MODERATION_CONFIG_SETTING_KEY, stored);
  }
  const published: Array<{ type: string; data: Record<string, unknown> }> = [];
  const requests: Partial<user_event.ListRecentUserEventsRequest>[] = [];
  const logs: string[] = [];
  const ctx = {
    db: {
      async getSetting(key: string) {
        return settings.get(key) ?? null;
      },
      async setSetting(key: string, value: string) {
        settings.set(key, value);
      },
      async listRecentUserEvents(req: Partial<user_event.ListRecentUserEventsRequest>) {
        requests.push(req);
        return { events, total: 0n, more: false };
      },
    },
    async publishEvent(type: string, data: Record<string, unknown>) {
      published.push({ type, data });
    },
    logger: {
      error: (message: string) => logs.push(message),
      warn: (message: string) => logs.push(message),
    },
  };
  const call = <A extends unknown[], R>(route: (...args: A) => Promise<R>) => {
    const method = route as unknown as (this: typeof ctx, ...args: A) => Promise<R>;
    return (...args: A) => method.apply(ctx, args);
  };
  return {
    get: call(moderationRoutes.getModerationConfig),
    set: call(moderationRoutes.setModerationConfig),
    list: call(moderationRoutes.listModerationActions) as (limit?: number) => Promise<ModerationActionRecord[]>,
    settings,
    published,
    requests,
    logs,
  };
}

describe("getModerationConfig", () => {
  test("answers the default, moderation off, when nothing is stored", async () => {
    expect(await setup().get()).toEqual(DEFAULT_MODERATION_CONFIG);
  });

  test("answers the stored config", async () => {
    expect(await setup(JSON.stringify(CONFIG)).get()).toEqual(CONFIG);
  });

  const broken: Array<[name: string, stored: string]> = [
    ["not JSON", "{"],
    ["invalid", JSON.stringify({ ...CONFIG, version: 2 })],
  ];
  for (const [name, stored] of broken) {
    test(`answers the default for a stored config that is ${name}, and logs it`, async () => {
      const routes = setup(stored);
      expect(await routes.get()).toEqual(DEFAULT_MODERATION_CONFIG);
      expect(routes.logs).toHaveLength(1);
    });
  }
});

describe("setModerationConfig", () => {
  test("stores the config, tells the engine, and round-trips it", async () => {
    const routes = setup();
    expect(await routes.set(CONFIG)).toEqual(CONFIG);
    expect(JSON.parse(routes.settings.get(MODERATION_CONFIG_SETTING_KEY) ?? "")).toEqual(CONFIG);
    expect(routes.published).toEqual([{ type: MODERATION_SUBJECTS.configUpdated, data: {} }]);
    expect(await routes.get()).toEqual(CONFIG);
  });

  const invalid: Array<[name: string, config: unknown, error: string]> = [
    ["an unknown version", { ...CONFIG, version: 2 }, "version 2"],
    ["the broadcaster not exempt", { ...CONFIG, exempt: { ...CONFIG.exempt, broadcaster: false } }, "broadcaster"],
    [
      "a rule without actions",
      { ...CONFIG, rules: { links: { ...CONFIG.rules.links, actions: [] } } },
      "must list at least one action",
    ],
    [
      "timeout and ban together",
      {
        ...CONFIG,
        rules: {
          links: { ...CONFIG.rules.links, actions: [{ kind: "timeout", durationSeconds: 60 }, { kind: "ban" }] },
        },
      },
      "not both",
    ],
    [
      "a warning reason that reads as a command",
      { ...CONFIG, rules: { links: { ...CONFIG.rules.links, actions: [{ kind: "warn", reason: "/ban x" }] } } },
      'must not start with "/"',
    ],
    [
      "a bad banned phrase",
      {
        ...CONFIG,
        rules: {
          banned_phrases: {
            enabled: true,
            actions: [{ kind: "delete" }],
            params: { phrases: [{ pattern: "(a|b)", wholeWord: false }] },
          },
        },
      },
      "phrases[0]",
    ],
    ["an unknown filter", { ...CONFIG, rules: { colours: CONFIG.rules.links } }, "is not a filter"],
  ];
  for (const [name, config, error] of invalid) {
    test(`refuses ${name}, storing and publishing nothing`, async () => {
      const routes = setup();
      await expect(routes.set(config as ModerationConfig)).rejects.toThrow(error);
      expect(routes.settings.size).toBe(0);
      expect(routes.published).toHaveLength(0);
    });
  }
});

describe("listModerationActions", () => {
  test("reads the logged actions, newest first as the log answers them", async () => {
    const routes = setup(null, [logged(ACTION, "ce-2"), logged({ ...ACTION, messageId: "m-0" }, "ce-1")]);
    const records = await routes.list();
    expect(routes.requests).toEqual([{ limit: 50, skipTotal: true, eventTypes: [MODERATION_SUBJECTS.actionTaken] }]);
    expect(records).toEqual([
      { ...ACTION, id: "ce-2", time: "2026-09-21T14:13:20.000Z" },
      { ...ACTION, messageId: "m-0", id: "ce-1", time: "2026-09-21T14:13:20.000Z" },
    ]);
  });

  test("leaves out a logged event not in the engine's shape", async () => {
    const routes = setup(null, [logged({ filter: "nope" }), logged(ACTION)]);
    expect((await routes.list()).map((record) => record.messageId)).toEqual(["m-1"]);
    expect(routes.logs).toHaveLength(1);
  });

  for (const limit of [0, 101, 1.5]) {
    test(`refuses a limit of ${limit}`, async () => {
      await expect(setup().list(limit)).rejects.toThrow("limit must be an integer from 1 to 100");
    });
  }
});
