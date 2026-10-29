import { describe, expect, mock, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import type { CallbackEvent } from "@woofx3/api/webhooks";
import type * as local_ui_setting from "@woofx3/db/local_ui_setting.pb";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";
import { SessionLease } from "../src/client-sessions";
import type { WebhookClient } from "../src/webhook-client";

const UPDATED_AT = { seconds: 1_792_497_600n, nanos: 0 };

/**
 * A db-proxy stand-in with the counter and conflict rule of
 * LocalUISettingRepository.Write, so the route is exercised against the
 * answers it really gets.
 */
function fakeDb() {
  const rows = new Map<string, local_ui_setting.LocalUISetting>();
  let counter = 0n;
  const requests: unknown[] = [];

  function write(
    namespace: string,
    key: string,
    valueJson: string | null,
    expected: bigint | undefined
  ): local_ui_setting.SetLocalUISettingResponse {
    const current = rows.get(`${namespace}/${key}`);
    if (expected !== undefined) {
      const matches =
        (current !== undefined && current.revision === expected) ||
        (expected === 0n && (current === undefined || current.deleted));
      if (!matches) {
        // As protoscript decodes it: an absent row arrives as an empty message.
        const stored = current ?? {
          namespace: "",
          key: "",
          valueJson: "",
          revision: 0n,
          updatedAt: { seconds: 0n, nanos: 0 },
          deleted: false,
        };
        return { status: { code: "OK", message: "" }, setting: stored, conflict: true };
      }
    }
    counter += 1n;
    const row: local_ui_setting.LocalUISetting = {
      namespace,
      key,
      valueJson: valueJson ?? "",
      revision: counter,
      updatedAt: UPDATED_AT,
      deleted: valueJson === null,
    };
    rows.set(`${namespace}/${key}`, row);
    return { status: { code: "OK", message: "" }, setting: row, conflict: false };
  }

  return {
    requests,
    async listLocalUISettings(namespace: string) {
      return [...rows.values()].filter((row) => row.namespace === namespace && !row.deleted);
    },
    async findLocalUISetting(namespace: string, key: string) {
      const row = rows.get(`${namespace}/${key}`);
      return row === undefined || row.deleted ? null : row;
    },
    async setLocalUISetting(req: local_ui_setting.SetLocalUISettingRequest) {
      requests.push(req);
      return write(req.namespace, req.key, req.valueJson, req.expectedRevision ?? undefined);
    },
    async deleteLocalUISetting(req: local_ui_setting.DeleteLocalUISettingRequest) {
      requests.push(req);
      return write(req.namespace, req.key, null, req.expectedRevision ?? undefined);
    },
    async listLocalUISettingChanges(req: local_ui_setting.ListLocalUISettingChangesRequest) {
      requests.push(req);
      const after = [...rows.values()]
        .filter((row) => row.revision > req.afterRevision)
        .sort((a, b) => (a.revision < b.revision ? -1 : 1));
      const limit = req.limit === 0 ? 100 : req.limit;
      return { settings: after.slice(0, limit), hasMore: after.length > limit };
    },
  };
}

function session() {
  const db = fakeDb();
  const sent: CallbackEvent[] = [];
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: null,
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
  });
  api.setWebhookClient({
    send: mock(async (event: CallbackEvent) => {
      sent.push(event);
    }),
  } as unknown as WebhookClient);
  return {
    db,
    sent,
    rpc: new ApiSession(api, "dash-client", new SessionLease(() => {})) as unknown as Woofx3EngineApi,
  };
}

describe("UI settings", () => {
  test("a set stores JSON text and announces the change", async () => {
    const { db, sent, rpc } = session();

    const result = await rpc.setUISetting("dashboardLayouts", "main", { widgets: [{ id: "w1", x: 0 }] });

    expect(result).toEqual({
      ok: true,
      setting: {
        namespace: "dashboardLayouts",
        key: "main",
        value: { widgets: [{ id: "w1", x: 0 }] },
        revision: 1,
        updatedAt: "2026-10-20T12:00:00.000Z",
        deleted: false,
      },
    });
    expect(db.requests[0]).toMatchObject({ valueJson: '{"widgets":[{"id":"w1","x":0}]}', expectedRevision: undefined });
    expect(sent).toEqual([
      {
        type: "ui.setting.changed",
        namespace: "dashboardLayouts",
        key: "main",
        revision: 1,
        deleted: false,
        value: { widgets: [{ id: "w1", x: 0 }] },
      },
    ]);
    expect(await rpc.getUISetting("dashboardLayouts", "main")).toMatchObject({ revision: 1 });
    expect(await rpc.listUISettings("dashboardLayouts")).toHaveLength(1);
  });

  test("a conflict answers with the stored setting and announces nothing", async () => {
    const { db, sent, rpc } = session();
    await rpc.setUISetting("macros", "m1", ["a"]);

    const result = await rpc.setUISetting("macros", "m1", ["b"], 0);

    expect(result).toMatchObject({ ok: false, reason: "conflict", current: { revision: 1, value: ["a"] } });
    expect(db.requests[1]).toMatchObject({ expectedRevision: 0n });
    expect(sent).toHaveLength(1);
  });

  test("a conflict on a key never written carries no setting", async () => {
    const { rpc } = session();
    expect(await rpc.deleteUISetting("macros", "nope", 3)).toEqual({ ok: false, reason: "conflict", current: null });
  });

  test("a delete leaves a tombstone that only the changes show", async () => {
    const { sent, rpc } = session();
    await rpc.setUISetting("dashboardNotes", "n1", "hello");
    await rpc.setUISetting("dashboardCounters", "c1", 3);

    const result = await rpc.deleteUISetting("dashboardNotes", "n1", 1);

    expect(result).toMatchObject({ ok: true, setting: { revision: 3, deleted: true, value: null } });
    expect(sent[2]).toEqual({
      type: "ui.setting.changed",
      namespace: "dashboardNotes",
      key: "n1",
      revision: 3,
      deleted: true,
      value: null,
    });
    expect(await rpc.getUISetting("dashboardNotes", "n1")).toBeNull();
    expect(await rpc.listUISettings("dashboardNotes")).toEqual([]);

    const changes = await rpc.listUISettingChangesSince(1);
    expect(changes.hasMore).toBe(false);
    expect(changes.changes.map((c) => [c.key, c.revision, c.deleted])).toEqual([
      ["c1", 2, false],
      ["n1", 3, true],
    ]);
  });

  test("changes page by revision", async () => {
    const { db, rpc } = session();
    for (const key of ["a", "b", "c"]) {
      await rpc.setUISetting("dashboardNotes", key, key);
    }

    const first = await rpc.listUISettingChangesSince(0, 2);
    expect(first.changes.map((c) => c.key)).toEqual(["a", "b"]);
    expect(first.hasMore).toBe(true);
    const rest = await rpc.listUISettingChangesSince(first.changes[1].revision, 2);
    expect(rest.changes.map((c) => c.key)).toEqual(["c"]);
    expect(rest.hasMore).toBe(false);
    expect(db.requests.at(-1)).toEqual({ afterRevision: 2n, limit: 2 });
  });

  test("refuses what cannot be sent", async () => {
    const { db, rpc } = session();
    const loose = rpc as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    await expect(loose.setUISetting("n", "k", undefined)).rejects.toThrow("not representable as JSON");
    await expect(loose.setUISetting("n", "k", 1n)).rejects.toThrow("not representable as JSON");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(loose.setUISetting("n", "k", cyclic)).rejects.toThrow("not representable as JSON");
    await expect(loose.setUISetting(7, "k", 1)).rejects.toThrow("namespace must be a string");
    await expect(loose.deleteUISetting("n", null)).rejects.toThrow("key must be a string");
    await expect(loose.setUISetting("n", "k", 1, -1)).rejects.toThrow(
      "expectedRevision must be a non-negative integer"
    );
    await expect(loose.setUISetting("n", "k", 1, 1.5)).rejects.toThrow(
      "expectedRevision must be a non-negative integer"
    );
    await expect(loose.listUISettingChangesSince(-1)).rejects.toThrow("revision must be a non-negative integer");
    await expect(loose.listUISettingChangesSince(0, "10")).rejects.toThrow("limit must be a non-negative integer");
    expect(db.requests).toEqual([]);
  });
});
