import { describe, expect, it, mock } from "bun:test";
import { reportAlertNotPlayed } from "../src/events/alert-dispatch";
import { initSubscriptions, notifySceneUpdated, SCENE_UPDATED_EVENT } from "../src/nats-subscriptions";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

type LifecycleRequest = {
  envelopeId: string;
  status: string;
  error: string;
};

function writer(result: () => Promise<unknown> = async () => ({})) {
  const calls: LifecycleRequest[] = [];
  return {
    calls,
    client: {
      updateAlertLifecycle: (req: LifecycleRequest) => {
        calls.push(req);
        return result();
      },
    },
  };
}

describe("reportAlertNotPlayed", () => {
  it("records the refusal against the envelope id the engine minted", async () => {
    const { calls, client } = writer();

    await reportAlertNotPlayed(client, fakeLogger(), {
      alertId: "env-1",
      reason: "layout must be an object, got nothing",
    });

    expect(calls).toEqual([
      {
        envelopeId: "env-1",
        status: "failed",
        error: "layout must be an object, got nothing",
      },
    ]);
  });

  // The engine writes the row best-effort, so an alert published without one
  // answers NOT_FOUND. That is the expected case, not a fault — and throwing
  // here would kill the subscription and stop every alert behind it.
  it("survives a missing row without throwing", async () => {
    const debug = mock((_message: string, _meta?: unknown) => {});
    const logger = { ...fakeLogger(), debug };
    const { client } = writer(async () => {
      throw new Error("db.updateAlertLifecycle: not_found: alert not found for envelope");
    });

    await reportAlertNotPlayed(client, logger, {
      alertId: "env-1",
      reason: "the layout contains no widgets",
    });

    expect(debug).toHaveBeenCalledTimes(1);
  });

  // A correct alert nobody was listening for is still worth reporting: from
  // the browser it is indistinguishable from one that was never sent.
  it("carries the target name when nothing was listening", async () => {
    const { calls, client } = writer();

    await reportAlertNotPlayed(client, fakeLogger(), {
      alertId: "env-1",
      reason: 'no alert widget named "sidebar" on a running scene',
    });

    expect(calls[0]?.error).toBe('no alert widget named "sidebar" on a running scene');
    expect(calls[0]?.status).toBe("failed");
  });
});

describe("notifySceneUpdated", () => {
  function broadcaster() {
    const calls: Array<{ sceneId: string; event: string; data: unknown }> = [];
    return {
      calls,
      scenes: {
        broadcast: (sceneId: string, event: string, data: unknown) => {
          calls.push({ sceneId, event, data });
        },
      },
    };
  }

  it("pushes scene-updated to the scene the db event names", () => {
    const { calls, scenes } = broadcaster();

    expect(notifySceneUpdated(scenes, { data: { id: "scene-1" } })).toBe("scene-1");

    expect(calls).toEqual([{ sceneId: "scene-1", event: SCENE_UPDATED_EVENT, data: { sceneId: "scene-1" } }]);
  });

  it("pushes nothing for an event without a scene id", () => {
    const { calls, scenes } = broadcaster();

    expect(notifySceneUpdated(scenes, { data: {} })).toBeNull();
    expect(notifySceneUpdated(scenes, {})).toBeNull();

    expect(calls).toEqual([]);
  });
});

describe("alert queue control subjects", () => {
  /** A bus that records each subscription, so a test can deliver a request to one. */
  function fakeNats() {
    const handlers = new Map<string, (msg: any) => unknown>();
    return {
      handlers,
      nats: {
        subscribe: async (subject: string, handler: (msg: any) => unknown) => {
          handlers.set(subject, handler);
          return {};
        },
      },
    };
  }

  async function request(handlers: Map<string, (msg: any) => unknown>, subject: string, body: unknown) {
    let reply: unknown = null;
    await handlers.get(subject)!({
      subject,
      json: () => body,
      respond: (data: Uint8Array) => {
        reply = JSON.parse(new TextDecoder().decode(data));
        return true;
      },
    });
    return reply;
  }

  async function wire(deliveryStore: Record<string, unknown>, db: Record<string, unknown> = {}) {
    const { handlers, nats } = fakeNats();
    await initSubscriptions({
      nats: nats as any,
      obs: null,
      db: db as any,
      host: {} as any,
      deliveryStore: deliveryStore as any,
      moduleState: {} as any,
      resolver: {} as any,
      logger: fakeLogger(),
    });
    return handlers;
  }

  it("answers skip, clear and replay with a refusal when no overlay is open", async () => {
    const handlers = await wire({ connectedSceneIds: () => [] });

    expect(await request(handlers, "widget.queue.skip", {})).toEqual({
      ok: false,
      skipped: 0,
      reason: "no overlay is open",
    });
    expect(await request(handlers, "widget.queue.clear", {})).toEqual({
      ok: false,
      cleared: 0,
      reason: "no overlay is open",
    });
    expect(await request(handlers, "widget.queue.replay", { id: "row-1" })).toEqual({
      ok: false,
      reason: "no overlay is open",
    });
  });

  it("answers a failure it did not expect instead of leaving the caller to time out", async () => {
    const handlers = await wire({
      connectedSceneIds: () => {
        throw new Error("store unavailable");
      },
    });

    expect(await request(handlers, "widget.queue.skip", {})).toEqual({ ok: false, reason: "store unavailable" });
  });

  it("refuses a replay without an id", async () => {
    const handlers = await wire({ connectedSceneIds: () => ["scene-1"] });

    expect(await request(handlers, "widget.queue.replay", null)).toEqual({ ok: false, reason: "alert id is required" });
  });
});
