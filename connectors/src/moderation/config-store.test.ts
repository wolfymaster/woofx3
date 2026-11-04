import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MODERATION_CONFIG,
  MODERATION_CONFIG_SETTING_KEY,
  MODERATION_SUBJECTS,
  type ModerationConfig,
} from "@woofx3/api/moderation-config";
import { RecordingLogger } from "../host/testing";
import { ModerationConfigStore } from "./config-store";

const ENABLED: ModerationConfig = { ...DEFAULT_MODERATION_CONFIG, enabled: true, dryRun: true };

function setup(initial: string | null | Error) {
  let stored: string | null | Error = initial;
  const reads: string[] = [];
  const handlers = new Map<string, () => Promise<void>>();
  const logger = new RecordingLogger();
  const store = new ModerationConfigStore({
    settings: {
      getSetting: async (key) => {
        reads.push(key);
        if (stored instanceof Error) {
          throw stored;
        }
        return stored;
      },
    },
    bus: {
      subscribe: async (subject, handler) => {
        handlers.set(subject, () =>
          Promise.resolve(handler({ subject, data: new Uint8Array(), respond: () => false }, { receivedAt: 0 }))
        );
      },
    },
    logger,
  });
  const update = async (next: string | null | Error) => {
    stored = next;
    await handlers.get(MODERATION_SUBJECTS.configUpdated)?.();
  };
  return { store, reads, logger, update };
}

describe("ModerationConfigStore", () => {
  test("runs the default, moderation off, when nothing is stored", async () => {
    const { store, reads } = setup(null);
    await store.start();
    expect(store.current()).toEqual(DEFAULT_MODERATION_CONFIG);
    expect(reads).toEqual([MODERATION_CONFIG_SETTING_KEY]);
  });

  test("reads the stored config, and again on each update", async () => {
    const { store, update } = setup(JSON.stringify(ENABLED));
    await store.start();
    expect(store.current()).toEqual(ENABLED);
    await update(JSON.stringify({ ...ENABLED, dryRun: false }));
    expect(store.current().dryRun).toBe(false);
  });

  test("a snapshot taken before an update stays whole", async () => {
    const { store, update } = setup(JSON.stringify(ENABLED));
    await store.start();
    const snapshot = store.current();
    await update(JSON.stringify(DEFAULT_MODERATION_CONFIG));
    expect(snapshot).toEqual(ENABLED);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  const invalid: Array<[name: string, stored: string, problem: string]> = [
    ["not JSON", "{", "not JSON"],
    ["an invalid config", JSON.stringify({ ...ENABLED, version: 9 }), "invalid"],
  ];
  for (const [name, stored, problem] of invalid) {
    test(`logs a stored config that is ${name} and runs with moderation off`, async () => {
      const { store, logger, update } = setup(JSON.stringify(ENABLED));
      await store.start();
      await update(stored);
      expect(store.current()).toEqual(DEFAULT_MODERATION_CONFIG);
      expect(logger.entries.some((entry) => entry.level === "error" && entry.message.includes(problem))).toBe(true);
    });
  }

  test("keeps the config held when a reload cannot read the setting", async () => {
    const { store, logger, update } = setup(JSON.stringify(ENABLED));
    await store.start();
    await update(new Error("db-proxy down"));
    expect(store.current()).toEqual(ENABLED);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: "error", metadata: { error: "db-proxy down" } })
    );
  });

  test("throws when the first read fails", async () => {
    const { store } = setup(new Error("db-proxy down"));
    await expect(store.start()).rejects.toThrow("db-proxy down");
  });
});
