import { describe, expect, test } from "bun:test";
import { scenesRoutes } from "../src/routes/scenes";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function call(nats: unknown, sceneId = "scene-1") {
  const route = scenesRoutes.repairScene as unknown as (id: string) => Promise<unknown>;
  return route.call({ nats, logger: fakeLogger() }, sceneId);
}

function answering(reply: unknown, asked: Array<{ subject: string; body: unknown }> = []) {
  return {
    async request(subject: string, data: Uint8Array) {
      asked.push({ subject, body: JSON.parse(new TextDecoder().decode(data)) });
      return { data: new TextEncoder().encode(JSON.stringify(reply)) };
    },
  };
}

describe("repairScene", () => {
  test("asks the scene manager to repair the scene and passes its answer on", async () => {
    const asked: Array<{ subject: string; body: unknown }> = [];
    expect(await call(answering({ ok: true, backups: 2 }, asked))).toEqual({ ok: true, backups: 2 });
    expect(asked).toEqual([{ subject: "engine.scene.repair", body: { sceneId: "scene-1" } }]);
    const refused = { ok: false, reason: "failed", detail: "the unreadable data could not be backed up" };
    expect(await call(answering(refused))).toEqual(refused);
  });

  test("is unavailable when the scene manager cannot be reached or does not answer", async () => {
    expect(await call(null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(
      await call({
        async request() {
          throw new Error("timeout");
        },
      })
    ).toMatchObject({ ok: false, reason: "unavailable" });
  });

  test("refuses a request with no scene", async () => {
    expect(await call(answering({ ok: true, backups: 0 }), "")).toMatchObject({ ok: false, reason: "not_found" });
  });
});
