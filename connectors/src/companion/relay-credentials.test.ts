import { describe, expect, mock, test } from "bun:test";
import type { RelayConfig } from "@woofx3/api";
import type { StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { bytes } from "../host/testing";
import { askDashboardOverBus, type DashboardAnswer, RelayCredentialSource } from "./relay-credentials";

const NOW = 1_700_000_000_000;
const CREDENTIAL = "wfxr1.k1.eyJ2IjoxfQ.c2ln";

const STORED: StoredRelayConfig = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
  clientId: "dash-client",
};

const GRANT = {
  bridgeOrigin: STORED.bridgeOrigin,
  endpoints: STORED.endpoints,
  credential: CREDENTIAL,
  expiresAt: NOW + 300_000,
};

/**
 * A source over an in-memory `relay.config`. Each entry of `answers` is the
 * dashboard's answer, or an Error for a request that fails; `answeredBy` is
 * the client id of the dashboard the api reaches.
 */
function harness(answers: unknown[], initial: StoredRelayConfig | null = STORED, answeredBy?: string) {
  const state = { config: initial, now: NOW };
  const changes: Array<RelayConfig | null> = [];
  const request = mock(async (clientId: string): Promise<DashboardAnswer> => {
    const answer = answers.shift();
    if (answer instanceof Error) {
      throw answer;
    }
    return { clientId: answeredBy ?? clientId, answer: answer as DashboardAnswer["answer"] };
  });
  const writeConfig = mock(async (config: StoredRelayConfig) => {
    state.config = config;
  });
  const clearConfig = mock(async () => {
    state.config = null;
  });
  const source = new RelayCredentialSource({
    store: { relayConfig: async () => state.config, writeRelayConfig: writeConfig, clearRelayConfig: clearConfig },
    askDashboard: request,
    configChanged: (config) => changes.push(config),
    clock: { now: () => state.now },
  });
  return { state, request, writeConfig, clearConfig, changes, source };
}

/** A dashboard answer the test releases by hand, once the request has gone out. */
function heldAnswer(request: ReturnType<typeof harness>["request"]) {
  let release: (answer: unknown) => void = () => {};
  request.mockImplementationOnce(
    (clientId) =>
      new Promise((resolve) => {
        release = (answer) => resolve({ clientId, answer: answer as DashboardAnswer["answer"] });
      })
  );
  return {
    async sent() {
      while (request.mock.calls.length === 0) {
        await Bun.sleep(1);
      }
    },
    release: (value: unknown) => release(value),
  };
}

describe("RelayCredentialSource", () => {
  test("asks the dashboard that set the configuration", async () => {
    const { request, source } = harness([{ relay: GRANT }]);
    expect(await source.current()).toEqual(GRANT);
    expect(request).toHaveBeenCalledWith("dash-client");
  });

  test("answers null without asking when nothing is routed through a companion", async () => {
    const { request, source } = harness([], null);
    expect(await source.current()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  test("caches the credential until a minute before it expires", async () => {
    const renewed = { ...GRANT, credential: "wfxr1.k1.eyJ2IjoyfQ.c2ln", expiresAt: NOW + 600_000 };
    const { state, request, source } = harness([{ relay: GRANT }, { relay: renewed }]);
    await source.current();
    state.now = GRANT.expiresAt - 60_001;
    expect(await source.current()).toEqual(GRANT);
    expect(request).toHaveBeenCalledTimes(1);
    state.now = GRANT.expiresAt - 60_000;
    expect(await source.current()).toEqual(renewed);
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("force renews a credential that is still cached", async () => {
    const renewed = { ...GRANT, credential: "wfxr1.k1.eyJ2IjoyfQ.c2ln" };
    const { request, source } = harness([{ relay: GRANT }, { relay: renewed }]);
    await source.current();
    expect(await source.current(true)).toEqual(renewed);
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("concurrent callers share one request", async () => {
    const { request, source } = harness([{ relay: GRANT }]);
    const [a, b, c] = await Promise.all([source.current(), source.current(), source.current()]);
    expect(a).toEqual(GRANT);
    expect(b).toEqual(GRANT);
    expect(c).toEqual(GRANT);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("relay: null clears the stored configuration and tells the route watch", async () => {
    const { state, clearConfig, changes, source } = harness([{ relay: null }]);
    expect(await source.current()).toBeNull();
    expect(clearConfig).toHaveBeenCalledTimes(1);
    expect(state.config).toBeNull();
    expect(changes).toEqual([null]);
  });

  test("an answer naming another bridge replaces the stored configuration, keeping its client id", async () => {
    const moved = { ...GRANT, bridgeOrigin: "https://c-zyxwvutsrqpo.woofx3.tv" };
    const { state, writeConfig, changes, source } = harness([{ relay: moved }]);
    expect(await source.current()).toEqual(moved);
    expect(writeConfig).toHaveBeenCalledTimes(1);
    expect(state.config).toEqual({ ...STORED, bridgeOrigin: moved.bridgeOrigin });
    expect(changes).toEqual([{ ...STORED, bridgeOrigin: moved.bridgeOrigin }]);
  });

  test("an answer matching the stored configuration writes nothing", async () => {
    const { writeConfig, changes, source } = harness([{ relay: GRANT }]);
    await source.current();
    expect(writeConfig).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  test("a failed request throws and is not cached", async () => {
    const { source } = harness([new Error("dashboard answered HTTP 503"), { relay: GRANT }]);
    await expect(source.current()).rejects.toThrow("503");
    expect(await source.current()).toEqual(GRANT);
  });

  test("setConfig stores and clears the configuration and tells the route watch each time", async () => {
    const { state, changes, source } = harness([], null);
    await source.setConfig(STORED);
    expect(state.config).toEqual(STORED);
    await source.setConfig(null);
    expect(state.config).toBeNull();
    expect(changes).toEqual([STORED, null]);
  });

  test("a failed write rejects setConfig and tells the route watch nothing", async () => {
    const { writeConfig, changes, source } = harness([], null);
    writeConfig.mockImplementationOnce(async () => {
      throw new Error("db-proxy SetSetting: unavailable");
    });
    await expect(source.setConfig(STORED)).rejects.toThrow("unavailable");
    expect(changes).toEqual([]);
  });

  test("setConfig drops the cached credential", async () => {
    const renewed = { ...GRANT, credential: "wfxr1.k1.eyJ2IjoyfQ.c2ln" };
    const { request, source } = harness([{ relay: GRANT }, { relay: renewed }]);
    await source.current();
    await source.setConfig(STORED);
    expect(await source.current()).toEqual(renewed);
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("a renewal racing setConfig(null) does not bring the configuration back", async () => {
    const moved = { ...GRANT, bridgeOrigin: "https://c-zyxwvutsrqpo.woofx3.tv" };
    const { state, request, writeConfig, source } = harness([]);
    const held = heldAnswer(request);
    const renewal = source.current();
    await held.sent();
    await source.setConfig(null);
    held.release({ relay: moved });
    expect(await renewal).toBeNull();
    expect(state.config).toBeNull();
    expect(writeConfig).not.toHaveBeenCalled();
    expect(await source.current()).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("a relay: null answer racing a fresh setConfig does not erase it", async () => {
    const fresh = { ...STORED, bridgeOrigin: "https://c-zyxwvutsrqpo.woofx3.tv" };
    const freshGrant = { ...GRANT, bridgeOrigin: fresh.bridgeOrigin };
    const { state, request, clearConfig, source } = harness([]);
    const held = heldAnswer(request);
    const renewal = source.current();
    await held.sent();
    await source.setConfig(fresh);
    request.mockImplementationOnce(async (clientId) => ({ clientId, answer: { relay: freshGrant } }));
    held.release({ relay: null });
    expect(await renewal).toEqual(freshGrant);
    expect(state.config).toEqual(fresh);
    expect(clearConfig).not.toHaveBeenCalled();
  });

  test("setConfig waits for a renewal's write already under way, and wins", async () => {
    const fresh = { ...STORED, bridgeOrigin: "https://c-zyxwvutsrqpo.woofx3.tv" };
    const { state, clearConfig, source } = harness([{ relay: null }]);
    let finishClear: () => void = () => {};
    clearConfig.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishClear = () => {
            state.config = null;
            resolve();
          };
        })
    );
    const renewal = source.current();
    while (clearConfig.mock.calls.length === 0) {
      await Bun.sleep(1);
    }
    const set = source.setConfig(fresh);
    finishClear();
    await Promise.all([renewal, set]);
    expect(state.config).toEqual(fresh);
  });

  test("stop abandons a renewal waiting on the dashboard before it writes, and refuses later calls", async () => {
    const moved = { ...GRANT, bridgeOrigin: "https://c-zyxwvutsrqpo.woofx3.tv" };
    const { state, request, writeConfig, changes, source } = harness([]);
    const held = heldAnswer(request);
    const renewal = source.current();
    await held.sent();
    await source.stop();
    held.release({ relay: moved });
    await expect(renewal).rejects.toThrow("stopped");
    expect(writeConfig).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(state.config).toEqual(STORED);
    await expect(source.current()).rejects.toThrow("stopped");
    await expect(source.setConfig(null)).rejects.toThrow("stopped");
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("stop waits for a write already under way", async () => {
    const { writeConfig, source } = harness([], null);
    let finishWrite: () => void = () => {};
    writeConfig.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        })
    );
    const set = source.setConfig(STORED);
    while (writeConfig.mock.calls.length === 0) {
      await Bun.sleep(1);
    }
    let stopped = false;
    const stop = source.stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(1);
    expect(stopped).toBe(false);
    finishWrite();
    await Promise.all([set, stop]);
    expect(stopped).toBe(true);
  });

  test("stores the client id of the dashboard that answered when it registered again under a new one", async () => {
    const { state, request, source } = harness([{ relay: GRANT }], STORED, "dash-client-2");
    expect(await source.current()).toEqual(GRANT);
    expect(request).toHaveBeenCalledWith("dash-client");
    expect(state.config).toEqual({ ...STORED, clientId: "dash-client-2" });
  });
});

describe("askDashboardOverBus", () => {
  function asking(reply: string | Error) {
    const requests: Array<{ subject: string; body: unknown; timeout: number }> = [];
    const scope = {
      request: async (subject: string, data: Uint8Array, opts: { timeout: number }) => {
        requests.push({ subject, body: JSON.parse(new TextDecoder().decode(data)), timeout: opts.timeout });
        if (reply instanceof Error) {
          throw reply;
        }
        return { subject, data: bytes(reply) };
      },
    };
    return { requests, ask: askDashboardOverBus(() => scope, 6_000) };
  }

  test("asks the api on engine.companion.dashboard_credential with the stored client id", async () => {
    const { requests, ask } = asking(
      JSON.stringify({ status: "answered", clientId: "dash-client-2", answer: { relay: GRANT } })
    );
    expect(await ask("dash-client")).toEqual({ clientId: "dash-client-2", answer: { relay: GRANT } });
    expect(requests).toEqual([
      { subject: "engine.companion.dashboard_credential", body: { clientId: "dash-client" }, timeout: 6_000 },
    ]);
  });

  test("passes a null answer through", async () => {
    const { ask } = asking(JSON.stringify({ status: "answered", clientId: "dash-client", answer: { relay: null } }));
    expect(await ask("dash-client")).toEqual({ clientId: "dash-client", answer: { relay: null } });
  });

  const refusals: Array<[name: string, reply: string | Error, message: string]> = [
    ["no responder", new Error("503 no responders"), "no responders"],
    ["a reply that is not JSON", "not json", "not JSON"],
    ["a malformed reply", JSON.stringify({ status: "answered", answer: { relay: null } }), "malformed"],
    [
      "a malformed grant",
      JSON.stringify({ status: "answered", clientId: "d", answer: { relay: { ...GRANT, credential: "bearer x" } } }),
      "malformed",
    ],
    ["the api's failure", JSON.stringify({ status: "failed", error: "dashboard answered HTTP 503" }), "HTTP 503"],
  ];
  for (const [name, reply, message] of refusals) {
    test(`rejects on ${name}`, async () => {
      const { ask } = asking(reply);
      await expect(ask("dash-client")).rejects.toThrow(message);
    });
  }
});
