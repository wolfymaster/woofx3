import { describe, expect, mock, test } from "bun:test";
import type { StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { parseRelayCredentialResponse, RelayCredentialSource } from "../src/relay-credential-source";

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

function harness(answers: unknown[], initial: StoredRelayConfig | null = STORED, registered = ["dash-client"]) {
  const state = { config: initial, now: NOW };
  const request = mock(async (_request: unknown, _clientId: string) => {
    const answer = answers.shift();
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  const writeConfig = mock(async (config: StoredRelayConfig) => {
    state.config = config;
  });
  const clearConfig = mock(async () => {
    state.config = null;
  });
  const source = new RelayCredentialSource({
    dashboard: () => ({ request, clientIds: () => registered }),
    readConfig: async () => state.config,
    writeConfig,
    clearConfig,
    now: () => state.now,
  });
  return { state, request, writeConfig, clearConfig, source };
}

/** A dashboard answer the test releases by hand, once the request has gone out. */
function heldAnswer(request: ReturnType<typeof harness>["request"]) {
  let release: (value: unknown) => void = () => {};
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
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
  test("asks relay.credential.requested of the dashboard that set the configuration", async () => {
    const { request, source } = harness([{ relay: GRANT }]);
    expect(await source.current()).toEqual(GRANT);
    expect(request).toHaveBeenCalledWith({ type: "relay.credential.requested" }, "dash-client");
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

  test("relay: null clears the stored configuration", async () => {
    const { state, clearConfig, source } = harness([{ relay: null }]);
    expect(await source.current()).toBeNull();
    expect(clearConfig).toHaveBeenCalledTimes(1);
    expect(state.config).toBeNull();
  });

  test("an answer naming another bridge replaces the stored configuration, keeping its client id", async () => {
    const moved = { ...GRANT, bridgeOrigin: "https://c-zyxwvutsrqpo.woofx3.tv" };
    const { state, writeConfig, source } = harness([{ relay: moved }]);
    expect(await source.current()).toEqual(moved);
    expect(writeConfig).toHaveBeenCalledTimes(1);
    expect(state.config).toEqual({ ...STORED, bridgeOrigin: moved.bridgeOrigin });
  });

  test("an answer matching the stored configuration writes nothing", async () => {
    const { writeConfig, source } = harness([{ relay: GRANT }]);
    await source.current();
    expect(writeConfig).not.toHaveBeenCalled();
  });

  test("a malformed answer throws and is not cached", async () => {
    const { request, source } = harness([{ relay: { ...GRANT, credential: "bearer xyz" } }, { relay: GRANT }]);
    await expect(source.current()).rejects.toThrow("malformed");
    expect(await source.current()).toEqual(GRANT);
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("a failed request throws and is not cached", async () => {
    const { source } = harness([new Error("dashboard answered HTTP 503"), { relay: GRANT }]);
    await expect(source.current()).rejects.toThrow("503");
    expect(await source.current()).toEqual(GRANT);
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
    request.mockImplementationOnce(async () => ({ relay: freshGrant }));
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

  test("asks the registered dashboard when the one that set the configuration registered again", async () => {
    const { state, request, source } = harness([{ relay: GRANT }], STORED, ["dash-client-2"]);
    expect(await source.current()).toEqual(GRANT);
    expect(request).toHaveBeenCalledWith({ type: "relay.credential.requested" }, "dash-client-2");
    expect(state.config).toEqual({ ...STORED, clientId: "dash-client-2" });
  });
});

describe("parseRelayCredentialResponse", () => {
  test("accepts a grant and relay: null", () => {
    expect(parseRelayCredentialResponse({ relay: GRANT })).toEqual({ relay: GRANT });
    expect(parseRelayCredentialResponse({ relay: null })).toEqual({ relay: null });
  });

  test("refuses anything else", () => {
    const bad: unknown[] = [
      null,
      {},
      { relay: "x" },
      { relay: { ...GRANT, expiresAt: Number.NaN } },
      { relay: { ...GRANT, expiresAt: "soon" } },
      { relay: { ...GRANT, credential: "wfxr2.k1.a.b" } },
      { relay: { ...GRANT, credential: "wfxr1.k1.a" } },
      { relay: { ...GRANT, bridgeOrigin: "http://c-abcdefghijkl.woofx3.tv" } },
      { relay: { ...GRANT, endpoints: [{ moduleId: "woofx3_obs", endpointId: "" }] } },
    ];
    for (const body of bad) {
      expect(() => parseRelayCredentialResponse(body)).toThrow();
    }
  });
});
