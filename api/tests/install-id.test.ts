import { describe, expect, test } from "bun:test";
import { EngineInstallId, INSTALL_ID_SETTING_KEY, type InstallIdSettings } from "../src/install-id";

/** Engine settings in memory with the db proxy's write-if-absent, counting the calls made on them. */
function settings(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const calls = { reads: 0, writes: 0 };
  const store: InstallIdSettings & { failNextRead?: boolean } = {
    async getSetting(key) {
      calls.reads++;
      if (store.failNextRead) {
        store.failNextRead = false;
        throw new Error("db unavailable");
      }
      return values.get(key) ?? null;
    },
    async setSettingIfAbsent(key, value) {
      calls.writes++;
      if (!values.has(key)) {
        values.set(key, value);
      }
      return values.get(key) as string;
    },
  };
  return { store, values, calls };
}

function ids(...values: string[]): () => string {
  return () => {
    const next = values.shift();
    if (next === undefined) {
      throw new Error("no more ids");
    }
    return next;
  };
}

describe("EngineInstallId", () => {
  test("makes an id on first use, stores it, and keeps answering it", async () => {
    const { store, values, calls } = settings();
    const installId = new EngineInstallId(store, ids("id-1", "id-2"));

    expect(await installId.get()).toBe("id-1");
    expect(await installId.get()).toBe("id-1");
    expect(values.get(INSTALL_ID_SETTING_KEY)).toBe("id-1");
    expect(calls.writes).toBe(1);
  });

  test("uses the stored id without writing", async () => {
    const { store, calls } = settings({ [INSTALL_ID_SETTING_KEY]: "kept" });

    expect(await new EngineInstallId(store, ids("new")).get()).toBe("kept");
    expect(calls.writes).toBe(0);
  });

  test("shares one read and write between concurrent first calls", async () => {
    const { store, calls } = settings();
    const installId = new EngineInstallId(store, ids("id-1", "id-2"));

    const answers = await Promise.all([installId.get(), installId.get(), installId.get()]);

    expect(answers).toEqual(["id-1", "id-1", "id-1"]);
    expect(calls.writes).toBe(1);
  });

  test("two processes racing on a fresh database settle on the id that was written first", async () => {
    const { store } = settings();
    const first = new EngineInstallId(store, ids("id-1"));
    const second = new EngineInstallId(store, ids("id-2"));

    const answers = await Promise.all([first.get(), second.get()]);

    expect(answers).toEqual(["id-1", "id-1"]);
  });

  test("survives a restart: a new instance over the same settings answers the same id", async () => {
    const { store } = settings();
    const first = await new EngineInstallId(store, ids("id-1")).get();

    expect(await new EngineInstallId(store, ids("id-2")).get()).toBe(first);
  });

  test("does not cache a failure", async () => {
    const { store } = settings();
    store.failNextRead = true;
    const installId = new EngineInstallId(store, ids("id-1"));

    await expect(installId.get()).rejects.toThrow("db unavailable");
    expect(await installId.get()).toBe("id-1");
  });
});
