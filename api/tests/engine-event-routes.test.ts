import { describe, expect, mock, test } from "bun:test";
import type { EngineEventFrame } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import { Api } from "../src/api";
import { EngineEventStream } from "../src/engine-event-stream";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;

function newApi(db: object = {}) {
  const api = new Api({
    db: db as never,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  const stream = new EngineEventStream(logger);
  api.setEngineEventStream(stream);
  return { api, stream };
}

function recorder() {
  const frames: EngineEventFrame[] = [];
  return {
    frames,
    subscriber: {
      async onEngineEvent(frame: EngineEventFrame) {
        frames.push(frame);
      },
    },
  };
}

describe("subscribeEngineEvents types", () => {
  const cases: { name: string; types: unknown; error: string | null }[] = [
    { name: "absent", types: undefined, error: null },
    { name: "known types", types: [EngineEventType.WORKFLOW_DELETED, EngineEventType.SCENE_DELETED], error: null },
    { name: "an empty list", types: [], error: null },
    { name: "not a list", types: "workflow.deleted", error: "types must be a list of engine event types" },
    {
      name: "a misspelt type",
      types: ["workflow.delted"],
      error: 'types: "workflow.delted" is not an engine event type',
    },
    { name: "an empty string", types: [""], error: 'types: "" is not an engine event type' },
    { name: "a non-string", types: [7], error: "types: 7 is not an engine event type" },
  ];
  for (const { name, types, error } of cases) {
    test(name, async () => {
      const { api, stream } = newApi();
      const subscribe = api.subscribeEngineEvents(
        recorder().subscriber,
        types === undefined ? undefined : ({ types } as never),
        { session: {}, clientId: "local" }
      );
      if (error === null) {
        await subscribe;
        expect(stream.clientIds()).toEqual(["local"]);
        return;
      }
      await expect(subscribe).rejects.toThrow(error);
      expect(stream.subscriberCount).toBe(0);
    });
  }
});

describe("deleteClient", () => {
  test("drops the deleted client's event stream subscriptions", async () => {
    const db = {
      getClientByClientID: mock(async () => ({ client: { id: "row-1", clientId: "gone" } })),
      deleteClient: mock(async () => ({})),
    };
    const { api, stream } = newApi(db);
    const gone = recorder();
    const kept = recorder();
    await api.subscribeEngineEvents(gone.subscriber, undefined, { session: {}, clientId: "gone" });
    await api.subscribeEngineEvents(kept.subscriber, undefined, { session: {}, clientId: "kept" });

    expect(await api.deleteClient("gone")).toEqual({ success: true, message: "Client deleted" });

    expect(db.deleteClient).toHaveBeenCalledWith("row-1");
    expect(stream.clientIds()).toEqual(["kept"]);
  });
});
