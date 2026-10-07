import { describe, expect, it, mock } from "bun:test";
import { reportAlertNotPlayed } from "../src/events/alert-dispatch";
import { initSubscriptions, notifySceneUpdated } from "../src/nats-subscriptions";

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
  function documents() {
    const refreshed: string[] = [];
    return {
      refreshed,
      scenes: {
        refresh: async (sceneId: string) => {
          refreshed.push(sceneId);
        },
      },
    };
  }

  it("hands the save of the scene the db event names to the scene documents", () => {
    const { refreshed, scenes } = documents();

    expect(notifySceneUpdated(scenes, { data: { id: "scene-1" } })).toBe("scene-1");

    expect(refreshed).toEqual(["scene-1"]);
  });

  it("hands on nothing for an event without a scene id", () => {
    const { refreshed, scenes } = documents();

    expect(notifySceneUpdated(scenes, { data: {} })).toBeNull();
    expect(notifySceneUpdated(scenes, {})).toBeNull();

    expect(refreshed).toEqual([]);
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
      reply: "_INBOX.test",
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
      obs: { current: () => null, recycle: () => {}, reconnectNow: () => {} },
      obsStatus: () => ({ state: "connected", failure: null, address: "127.0.0.1:4455" }),
      relayConfigMovesObs: async () => false,
      db: db as any,
      host: {} as any,
      deliveryStore: deliveryStore as any,
      moduleState: {} as any,
      resolver: {} as any,
      sceneDocuments: { refresh: async () => {}, applyChange: async () => ({ ok: true as const }) },
      editorToken: async () => ({ ok: false, reason: "unused" }),
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

  // Workflows can publish to arbitrary subjects; a plain publish must not be
  // able to skip, clear or replay anything.
  it("ignores a publish that is not a request", async () => {
    let touched = false;
    const handlers = await wire({
      connectedSceneIds: () => {
        touched = true;
        return ["scene-1"];
      },
    });
    let responded = false;
    for (const subject of ["widget.queue.skip", "widget.queue.clear", "widget.queue.replay"]) {
      await handlers.get(subject)!({
        subject,
        json: () => ({ id: "row-1" }),
        respond: () => {
          responded = true;
          return false;
        },
      });
    }

    expect(touched).toBe(false);
    expect(responded).toBe(false);
  });

  it("refuses a replay without an id", async () => {
    const handlers = await wire({ connectedSceneIds: () => ["scene-1"] });

    expect(await request(handlers, "widget.queue.replay", null)).toEqual({ ok: false, reason: "alert id is required" });
  });
});

describe("module setting changes", () => {
  async function wire(relayConfigMovesObs: () => Promise<boolean> = async () => false) {
    const handlers = new Map<string, (msg: any) => unknown>();
    const reconnects: string[] = [];
    await initSubscriptions({
      nats: {
        subscribe: async (subject: string, handler: (msg: any) => unknown) => {
          handlers.set(subject, handler);
          return {};
        },
      } as any,
      obs: { current: () => null, recycle: () => {}, reconnectNow: (reason: string) => reconnects.push(reason) },
      obsStatus: () => ({ state: "retrying", failure: "authentication", address: "obs.lan:4455" }),
      relayConfigMovesObs,
      db: {} as any,
      host: {} as any,
      deliveryStore: {} as any,
      moduleState: {} as any,
      resolver: {} as any,
      sceneDocuments: { refresh: async () => {}, applyChange: async () => ({ ok: true as const }) },
      editorToken: async () => ({ ok: false, reason: "unused" }),
      logger: fakeLogger(),
    });
    const deliver = (data: unknown) => {
      const handler = handlers.get("db.module.setting.updated.*");
      if (!handler) {
        throw new Error("db.module.setting.updated.* is not subscribed");
      }
      return handler({ subject: "db.module.setting.updated.system", json: () => ({ data }) });
    };
    const relayChanged = () =>
      handlers.get("engine.relay.config.updated")?.({ subject: "engine.relay.config.updated" });
    return { deliver, relayChanged, reconnects };
  }

  it("reconnects to OBS when a relay configuration change moves it to another route", async () => {
    const { relayChanged, reconnects } = await wire(async () => true);
    await relayChanged();
    expect(reconnects).toEqual(["Relay configuration changed"]);
  });

  it("keeps the OBS session when a relay configuration change leaves its route alone", async () => {
    const { relayChanged, reconnects } = await wire(async () => false);
    await relayChanged();
    expect(reconnects).toEqual([]);
  });

  it("reconnects when the relay configuration cannot be read", async () => {
    const { relayChanged, reconnects } = await wire(async () => {
      throw new Error("db down");
    });
    await relayChanged();
    expect(reconnects).toEqual(["Relay configuration changed"]);
  });

  it("reconnects to OBS when the OBS module's settings change", async () => {
    const { deliver, reconnects } = await wire();
    await deliver({ moduleId: "woofx3_obs", key: "password" });
    expect(reconnects).toEqual(["OBS module settings changed"]);
  });

  it("ignores other modules' settings", async () => {
    const { deliver, reconnects } = await wire();
    await deliver({ moduleId: "woofx3_spotify", key: "clientId" });
    expect(reconnects).toEqual([]);
  });

  it("answers engine.obs.status with the connection's state", async () => {
    const handlers = new Map<string, (msg: unknown) => unknown>();
    await initSubscriptions({
      nats: {
        subscribe: async (subject: string, handler: (msg: unknown) => unknown) => {
          handlers.set(subject, handler);
          return {};
        },
      } as never,
      obs: { current: () => null, recycle: () => {}, reconnectNow: () => {} },
      obsStatus: () => ({ state: "retrying", failure: "authentication", address: "obs.lan:4455" }),
      relayConfigMovesObs: async () => false,
      db: {} as never,
      host: {} as never,
      deliveryStore: {} as never,
      moduleState: {} as never,
      resolver: {} as never,
      sceneDocuments: { refresh: async () => {}, applyChange: async () => ({ ok: true as const }) },
      editorToken: async () => ({ ok: false, reason: "unused" }),
      logger: fakeLogger(),
    });
    const handler = handlers.get("engine.obs.status");
    if (!handler) {
      throw new Error("engine.obs.status is not answered");
    }
    let reply: unknown = null;
    await handler({
      subject: "engine.obs.status",
      reply: "_INBOX.test",
      json: () => ({}),
      respond: (data: Uint8Array) => {
        reply = JSON.parse(new TextDecoder().decode(data));
        return true;
      },
    });
    expect(reply).toEqual({ state: "retrying", failure: "authentication", address: "obs.lan:4455" });
  });
});
