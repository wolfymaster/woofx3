import { describe, expect, mock, test } from "bun:test";
import type { EngineEventFrame } from "@woofx3/api";
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
