import { describe, expect, mock, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";
import { SessionLease } from "../src/client-sessions";

const TOKEN = { accessToken: "a", scope: ["chat:read"], expiresIn: 3600, obtainmentTimestamp: 1, userId: "42" };

interface Harness {
  rpc: Woofx3EngineApi;
  /** Settings and published subjects in the order they happened. */
  journal: string[];
  settings: Map<string, string>;
  warn: ReturnType<typeof mock>;
}

function harness(faults: { enabledWrite?: boolean; publish?: boolean } = {}): Harness {
  const settings = new Map<string, string>();
  const journal: string[] = [];
  const warn = mock(() => {});
  const db = {
    setSetting: mock(async (key: string, value: string) => {
      settings.set(key, value);
      journal.push(`set:${key}`);
    }),
    deleteSetting: mock(async (key: string) => {
      settings.delete(key);
      journal.push(`delete:${key}`);
    }),
    trySetSetting: mock(async (key: string, value: string) => {
      if (faults.enabledWrite && key.endsWith(".enabled")) {
        return false;
      }
      settings.set(key, value);
      journal.push(`set:${key}`);
      return true;
    }),
    findOrCreateByWoofx3UIUserId: mock(async () => ({ id: "engine-user" })),
  };
  const nats = {
    publish: mock(async (subject: string) => {
      if (faults.publish) {
        throw new Error("nats down");
      }
      journal.push(`publish:${subject}`);
    }),
  };
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: nats as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn, error: mock(() => {}) } as never,
  });
  return {
    rpc: new ApiSession(api, "dash", new SessionLease(() => {})) as unknown as Woofx3EngineApi,
    journal,
    settings,
    warn,
  };
}

const ENABLED_KEY = "integration.twitch.enabled";
const ENABLED_EVENT = "publish:setting.integration.enabled.updated";
const TOKEN_EVENT = "publish:setting.integration.token.updated";

describe("integration enabled setting", () => {
  test("setTwitchToken stores enabled=true and announces enabled before the token", async () => {
    const { rpc, journal, settings } = harness();
    await rpc.setTwitchToken(TOKEN);
    expect(settings.get(ENABLED_KEY)).toBe("true");
    expect(journal.filter((entry) => entry === ENABLED_EVENT || entry === TOKEN_EVENT)).toEqual([
      ENABLED_EVENT,
      TOKEN_EVENT,
    ]);
    expect(journal.indexOf(`set:${ENABLED_KEY}`)).toBeLessThan(journal.indexOf(ENABLED_EVENT));
  });

  test("deleteTwitchToken stores enabled=false and announces both events", async () => {
    const { rpc, journal, settings } = harness();
    await rpc.setTwitchToken(TOKEN);
    journal.length = 0;
    await rpc.deleteTwitchToken();
    expect(settings.get(ENABLED_KEY)).toBe("false");
    expect(journal.filter((entry) => entry.startsWith("publish:"))).toEqual([ENABLED_EVENT, TOKEN_EVENT]);
  });

  test("linking again after a disconnect re-enables", async () => {
    const { rpc, settings } = harness();
    await rpc.deleteTwitchToken();
    await rpc.setTwitchToken(TOKEN);
    expect(settings.get(ENABLED_KEY)).toBe("true");
  });

  test("a publish failure warns and does not throw", async () => {
    const { rpc, warn, settings } = harness({ publish: true });
    await expect(rpc.setTwitchToken(TOKEN)).resolves.toEqual({ ok: true });
    expect(settings.get(ENABLED_KEY)).toBe("true");
    const publishWarnings = warn.mock.calls
      .map(([message]) => message)
      .filter((m) => m.startsWith("Failed to publish"));
    expect(publishWarnings).toEqual([
      "Failed to publish setting.integration.enabled.updated",
      "Failed to publish setting.integration.token.updated",
    ]);
  });

  test("a failed enabled write fails setTwitchToken and publishes nothing", async () => {
    const { rpc, journal } = harness({ enabledWrite: true });
    await expect(rpc.setTwitchToken(TOKEN)).rejects.toThrow(`could not store ${ENABLED_KEY}`);
    expect(journal.some((entry) => entry.startsWith("publish:"))).toBe(false);
  });

  test("a failed enabled write fails deleteTwitchToken", async () => {
    const { rpc } = harness({ enabledWrite: true });
    await expect(rpc.deleteTwitchToken()).rejects.toThrow(`could not store ${ENABLED_KEY}`);
  });
});
