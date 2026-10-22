import { describe, expect, mock, test } from "bun:test";
import type { EngineEventFrame } from "@woofx3/api";
import { EngineEventType, EngineRequestType, makeRequestEnvelope } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import { Api } from "../src/api";
import { ClientRevoker, ClientSessions } from "../src/client-sessions";
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

describe("answerEngineRequest", () => {
  const SHAPE = "answer must be { ok: true, body } or { ok: false, error }";
  const cases: {
    name: string;
    requestId: unknown;
    answer: unknown;
    outcome: { body: unknown } | { refused: string } | { error: string };
  }[] = [
    {
      name: "ok with a body",
      requestId: null,
      answer: { ok: true, body: { token: "t" } },
      outcome: { body: { token: "t" } },
    },
    { name: "ok with no body", requestId: null, answer: { ok: true }, outcome: { body: undefined } },
    { name: "a refusal", requestId: null, answer: { ok: false, error: "no" }, outcome: { refused: "no" } },
    { name: "a refusal with no error", requestId: null, answer: { ok: false }, outcome: { error: SHAPE } },
    { name: "ok as a string", requestId: null, answer: { ok: "true", body: 1 }, outcome: { error: SHAPE } },
    { name: "no ok", requestId: null, answer: { body: 1 }, outcome: { error: SHAPE } },
    { name: "null", requestId: null, answer: null, outcome: { error: SHAPE } },
    {
      name: "an empty request id",
      requestId: "",
      answer: { ok: true, body: 1 },
      outcome: { error: "requestId must be a non-empty string" },
    },
    {
      name: "a non-string request id",
      requestId: 7,
      answer: { ok: true, body: 1 },
      outcome: { error: "requestId must be a non-empty string" },
    },
  ];
  for (const { name, requestId, answer, outcome } of cases) {
    test(name, async () => {
      const { api, stream } = newApi();
      await api.subscribeEngineEvents(recorder().subscriber, undefined, { session: {}, clientId: "local" });
      const envelope = makeRequestEnvelope({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED });
      const answered = stream.request(envelope, "local", 1_000);
      const call = api.answerEngineRequest((requestId ?? envelope.id) as string, answer as never, {
        clientId: "local",
      });

      if ("error" in outcome) {
        await expect(call).rejects.toThrow(outcome.error);
        // A malformed answer leaves the request waiting for a proper one.
        await api.answerEngineRequest(envelope.id, { ok: true, body: "later" }, { clientId: "local" });
        expect(await answered).toBe("later");
        return;
      }
      await call;
      if ("refused" in outcome) {
        await expect(answered).rejects.toThrow(`the client refused: ${outcome.refused}`);
        return;
      }
      expect(await answered).toEqual(outcome.body);
    });
  }
});

describe("deleteClient", () => {
  test("drops the deleted client's event stream subscriptions", async () => {
    const db = {
      getClientByClientID: mock(async () => ({ client: { id: "row-1", clientId: "gone" } })),
      deleteClient: mock(async () => ({ code: "OK" })),
    };
    const { api, stream } = newApi(db);
    api.setClientRevocation(
      new ClientRevoker({ invalidateCache() {} }, new ClientSessions(logger), stream, { dropClient() {} })
    );
    const gone = recorder();
    const kept = recorder();
    await api.subscribeEngineEvents(gone.subscriber, undefined, { session: {}, clientId: "gone" });
    await api.subscribeEngineEvents(kept.subscriber, undefined, { session: {}, clientId: "kept" });

    expect(await api.deleteClient("gone")).toEqual({ success: true, message: "Client deleted" });

    expect(db.deleteClient).toHaveBeenCalledWith("row-1");
    expect(stream.clientIds()).toEqual(["kept"]);
  });
});
