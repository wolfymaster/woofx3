import { afterEach, describe, expect, it, mock } from "bun:test";
import type { RelayConfig } from "@woofx3/api";
import { type RelayGrant, requestRelayCredentialOverNats } from "@woofx3/common/cloudevents/Relay/relay";
import {
  type DialerDeps,
  dialWebSocketEndpoint,
  directRouteFrom,
  EndpointRelayError,
  endpointKeysFromManifest,
  relayChangeMovesEndpoint,
} from "../../src/endpoints/dialer";
import { obsFailureKind } from "../../src/obs/connection";
import { obsDialTarget, openObsOverRoute } from "../../src/obs/settings";
import { type FakeObsServer, startFakeObs } from "../obs/fake-obs-server";

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} } as never;
const TARGET = obsDialTarget({ host: "127.0.0.1", port: "4455", token: "from-config" });
const ORIGIN = "https://c-x.woofx3.tv";
const TICKET = "T".repeat(43);
const CONFIG: RelayConfig = { bridgeOrigin: ORIGIN, endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }] };
const GRANT: RelayGrant = { ...CONFIG, credential: "wfxr1.k1.cGF5bG9hZA.c2ln", expiresAt: Date.now() + 300_000 };

const OBS_MANIFEST = JSON.stringify({
  id: "woofx3_obs",
  local: [{ id: "obs", hostSetting: "obsHost", portSetting: "obsPort", passwordSetting: "obsPassword" }],
});

function deps(overrides: Partial<DialerDeps> = {}) {
  const fetchMock = mock(async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({ ticket: TICKET }));
  const base: DialerDeps = {
    endpointKeys: async () => null,
    settings: async () => [
      { key: "host", value: "192.168.1.20" },
      { key: "port", value: "4460" },
    ],
    secrets: async () => ({ password: "hunter2" }),
    relayConfig: async () => null,
    relayCredential: async (_force: boolean) => GRANT,
    fetch: fetchMock as unknown as typeof fetch,
    logger: quietLogger,
  };
  return { deps: { ...base, ...overrides }, fetchMock };
}

describe("dialWebSocketEndpoint", () => {
  it("dials the settings' address with no relay configuration", async () => {
    const { deps: d, fetchMock } = deps();
    expect(await dialWebSocketEndpoint(d, TARGET)).toEqual({
      route: "direct",
      url: "ws://192.168.1.20:4460",
      password: "hunter2",
      address: "192.168.1.20:4460",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dials directly when the configuration does not list the endpoint", async () => {
    const { deps: d, fetchMock } = deps({
      relayConfig: async () => ({ ...CONFIG, endpoints: [{ moduleId: "woofx3_lights", endpointId: "obs" }] }),
    });
    expect((await dialWebSocketEndpoint(d, TARGET)).route).toBe("direct");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the credential for a ticket and dials the bridge when the endpoint is listed", async () => {
    const { deps: d, fetchMock } = deps({ relayConfig: async () => CONFIG });
    expect(await dialWebSocketEndpoint(d, TARGET)).toEqual({
      route: "companion",
      url: `wss://c-x.woofx3.tv/bridge/woofx3_obs/obs?ticket=${TICKET}`,
      password: "hunter2",
      address: "c-x.woofx3.tv",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://c-x.woofx3.tv/bridge/woofx3_obs/obs");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${GRANT.credential}`);
  });

  it("asks for a fresh ticket on every attempt", async () => {
    const { deps: d, fetchMock } = deps({ relayConfig: async () => CONFIG });
    await dialWebSocketEndpoint(d, TARGET);
    await dialWebSocketEndpoint(d, TARGET);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dials the bridge the credential is for, and reports its host when it refuses", async () => {
    const moved = { ...GRANT, bridgeOrigin: "https://c-y.woofx3.tv" };
    const { deps: d } = deps({ relayConfig: async () => CONFIG, relayCredential: async () => moved });
    expect((await dialWebSocketEndpoint(d, TARGET)).url).toStartWith("wss://c-y.woofx3.tv/bridge/");
    d.fetch = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    const err = await dialWebSocketEndpoint(d, TARGET).catch((e) => e);
    expect(err.address).toBe("c-y.woofx3.tv");
  });

  it("renews the credential once when the relay refuses it with 401", async () => {
    const fresh = { ...GRANT, credential: "wfxr1.k1.ZnJlc2g.c2ln" };
    const relayCredential = mock(async (force: boolean) => (force ? fresh : GRANT));
    const fetchMock = mock(async (_url: URL | RequestInfo, init?: RequestInit) =>
      new Headers(init?.headers).get("authorization") === `Bearer ${fresh.credential}`
        ? Response.json({ ticket: TICKET })
        : new Response("no", { status: 401 })
    );
    const { deps: d } = deps({
      relayConfig: async () => CONFIG,
      relayCredential,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect((await dialWebSocketEndpoint(d, TARGET)).route).toBe("companion");
    expect(relayCredential.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 401", async () => {
    const relayCredential = mock(async (_force: boolean) => GRANT);
    const { deps: d } = deps({
      relayConfig: async () => CONFIG,
      relayCredential,
      fetch: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch,
    });
    const err = await dialWebSocketEndpoint(d, TARGET).catch((e) => e);
    expect(err).toBeInstanceOf(EndpointRelayError);
    expect(relayCredential).toHaveBeenCalledTimes(2);
  });

  for (const status of [401, 404, 429, 502, 503]) {
    it(`throws a relay error when the ticket exchange answers ${status}`, async () => {
      const { deps: d } = deps({
        relayConfig: async () => CONFIG,
        fetch: (async () => new Response("no", { status })) as unknown as typeof fetch,
      });
      const err = await dialWebSocketEndpoint(d, TARGET).catch((e) => e);
      expect(err).toBeInstanceOf(EndpointRelayError);
      expect(obsFailureKind(err)).toBe("relay");
      expect(err.address).toBe("c-x.woofx3.tv");
      expect(err.message).toContain(String(status));
    });
  }

  it("throws a relay error when the relay does not answer or answers without a ticket", async () => {
    for (const fetchImpl of [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => Response.json({ ticket: "short" }),
      async () => new Response("not json"),
    ]) {
      const { deps: d } = deps({ relayConfig: async () => CONFIG, fetch: fetchImpl as unknown as typeof fetch });
      await expect(dialWebSocketEndpoint(d, TARGET)).rejects.toBeInstanceOf(EndpointRelayError);
    }
  });

  it("throws a relay error when no credential can be had", async () => {
    const { deps: d } = deps({
      relayConfig: async () => CONFIG,
      relayCredential: async () => {
        throw new Error("the api service could not get a relay credential: dashboard answered HTTP 503");
      },
    });
    const err = await dialWebSocketEndpoint(d, TARGET).catch((e) => e);
    expect(err).toBeInstanceOf(EndpointRelayError);
    expect(err.address).toBe("c-x.woofx3.tv");
  });

  it("dials directly when the credential source answers null", async () => {
    const { deps: d, fetchMock } = deps({ relayConfig: async () => CONFIG, relayCredential: async () => null });
    expect((await dialWebSocketEndpoint(d, TARGET)).route).toBe("direct");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dials directly when the dashboard's answer no longer routes the endpoint", async () => {
    const { deps: d } = deps({
      relayConfig: async () => CONFIG,
      relayCredential: async () => ({ ...GRANT, endpoints: [] }),
    });
    expect((await dialWebSocketEndpoint(d, TARGET)).route).toBe("direct");
  });

  it("reads the settings the stored manifest's local[] entry names", async () => {
    const { deps: d } = deps({
      endpointKeys: async (moduleId, endpointId) =>
        moduleId === "woofx3_obs" ? endpointKeysFromManifest(OBS_MANIFEST, endpointId) : null,
      settings: async () => [
        { key: "obsHost", value: "obs.lan" },
        { key: "obsPort", value: "4470" },
        { key: "host", value: "ignored" },
      ],
      secrets: async () => ({ obsPassword: "s3cret", password: "ignored" }),
    });
    expect(await dialWebSocketEndpoint(d, TARGET)).toMatchObject({ url: "ws://obs.lan:4470", password: "s3cret" });
  });

  it("uses the configuration when the settings are unreadable", async () => {
    const { deps: d } = deps({
      settings: async () => {
        throw new Error("db down");
      },
    });
    expect(await dialWebSocketEndpoint(d, TARGET)).toEqual({
      route: "direct",
      url: "ws://127.0.0.1:4455",
      password: "from-config",
      address: "127.0.0.1:4455",
    });
  });
});

describe("relayChangeMovesEndpoint", () => {
  const direct = { route: "direct" as const, address: "127.0.0.1:4455" };
  const bridged = { route: "companion" as const, address: "c-x.woofx3.tv" };

  it("moves a direct session onto a bridge that now lists the endpoint", () => {
    expect(relayChangeMovesEndpoint(CONFIG, TARGET, direct)).toBe(true);
  });

  it("moves a bridged session off when the endpoint is no longer listed", () => {
    expect(relayChangeMovesEndpoint(null, TARGET, bridged)).toBe(true);
    expect(relayChangeMovesEndpoint({ ...CONFIG, endpoints: [] }, TARGET, bridged)).toBe(true);
  });

  it("moves a bridged session to another bridge", () => {
    expect(relayChangeMovesEndpoint({ ...CONFIG, bridgeOrigin: "https://c-y.woofx3.tv" }, TARGET, bridged)).toBe(true);
  });

  it("leaves a session whose route is unchanged", () => {
    expect(relayChangeMovesEndpoint(CONFIG, TARGET, bridged)).toBe(false);
    expect(relayChangeMovesEndpoint(null, TARGET, direct)).toBe(false);
    expect(
      relayChangeMovesEndpoint(
        { ...CONFIG, endpoints: [{ moduleId: "woofx3_lights", endpointId: "obs" }] },
        TARGET,
        direct
      )
    ).toBe(false);
  });

  it("reconnects when no attempt has reported a route yet", () => {
    expect(relayChangeMovesEndpoint(CONFIG, TARGET, null)).toBe(true);
  });
});

describe("opening OBS on a route", () => {
  let fake: FakeObsServer | null = null;
  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  it("negotiates the subprotocol, signs in and loads the scenes", async () => {
    fake = startFakeObs({ password: "hunter2" });
    const session = await openObsOverRoute(
      { route: "direct", url: fake.url, password: "hunter2", address: "127.0.0.1" },
      quietLogger
    );
    expect(fake.protocols).toEqual(["obswebsocket.msgpack"]);
    expect(fake.requests).toEqual(["GetSceneList", "GetSceneItemList", "GetSceneItemList"]);
    await session.close();
  });

  it("reaches OBS at a bridge path whose ticket the server checks", async () => {
    fake = startFakeObs({ acceptUrl: (url) => url.searchParams.get("ticket") === TICKET });
    const route = {
      route: "companion" as const,
      url: `${fake.url}/bridge/woofx3_obs/obs?ticket=${TICKET}`,
      address: "127.0.0.1",
    };
    const session = await openObsOverRoute(route, quietLogger);
    expect(fake.upgrades.map((u) => u.pathname)).toEqual(["/bridge/woofx3_obs/obs"]);
    await session.close();
  });

  it("reads a refused bridge upgrade as a relay failure, and a direct one as unreachable", async () => {
    fake = startFakeObs({ acceptUrl: () => false });
    const bridged = await openObsOverRoute(
      { route: "companion", url: `${fake.url}/bridge/woofx3_obs/obs?ticket=spent`, address: "c-x.woofx3.tv" },
      quietLogger
    ).catch((e) => e);
    expect(bridged).toBeInstanceOf(EndpointRelayError);
    expect(bridged.address).toBe("c-x.woofx3.tv");
    expect(obsFailureKind(bridged)).toBe("relay");
    const direct = await openObsOverRoute({ route: "direct", url: fake.url, address: "127.0.0.1" }, quietLogger).catch(
      (e) => e
    );
    expect(obsFailureKind(direct)).toBe("unreachable");
  });

  it("reads a wrong password as an authentication failure on either route", async () => {
    fake = startFakeObs({ password: "hunter2" });
    for (const route of ["direct", "companion"] as const) {
      const err = await openObsOverRoute(
        { route, url: fake.url, password: "wrong", address: "127.0.0.1" },
        quietLogger
      ).catch((e) => e);
      expect(err.code).toBe(4009);
      expect(obsFailureKind(err)).toBe("authentication");
    }
  });
});

describe("endpointKeysFromManifest", () => {
  it("finds the endpoint's keys", () => {
    expect(endpointKeysFromManifest(OBS_MANIFEST, "obs")).toEqual({
      hostSetting: "obsHost",
      portSetting: "obsPort",
      passwordSetting: "obsPassword",
    });
  });

  it("counts anything it cannot read as absent", () => {
    for (const manifest of [
      null,
      "",
      "{",
      JSON.stringify({ id: "woofx3_obs" }),
      JSON.stringify({ local: {} }),
      JSON.stringify({ local: [{ id: "other", hostSetting: "h", portSetting: "p" }] }),
      JSON.stringify({ local: [{ id: "obs", hostSetting: 1, portSetting: "p" }] }),
    ]) {
      expect(endpointKeysFromManifest(manifest, "obs")).toBeNull();
    }
  });
});

describe("directRouteFrom", () => {
  const keys = { hostSetting: "host", portSetting: "port", passwordSetting: "password" };
  const fallback = { host: "127.0.0.1", port: "4455", password: "from-config" };

  it("falls back to the configuration for each empty setting", () => {
    expect(directRouteFrom([{ key: "host", value: "  " }], {}, keys, fallback)).toEqual({
      route: "direct",
      url: "ws://127.0.0.1:4455",
      password: "from-config",
      address: "127.0.0.1:4455",
    });
  });

  it("falls back for a port that is not a port", () => {
    for (const value of ["0", "65536", "44.55", "abc"]) {
      expect(directRouteFrom([{ key: "port", value }], {}, keys, fallback).url).toBe("ws://127.0.0.1:4455");
    }
  });

  it("leaves the password out when neither the module nor the configuration has one", () => {
    expect(directRouteFrom([], {}, keys, { host: "obs.lan", port: "4455" })).toEqual({
      route: "direct",
      url: "ws://obs.lan:4455",
      address: "obs.lan:4455",
    });
  });

  it("brackets an IPv6 host", () => {
    expect(directRouteFrom([{ key: "host", value: "::1" }], {}, keys, fallback).url).toBe("ws://[::1]:4455");
  });
});

describe("requestRelayCredentialOverNats", () => {
  const encode = (body: unknown) => ({ data: new TextEncoder().encode(JSON.stringify(body)) });

  it("asks engine.relay.credential with force and returns the grant", async () => {
    const request = mock(async (_subject: string, _data: Uint8Array, _opts?: { timeout?: number }) =>
      encode({ relay: GRANT })
    );
    expect(await requestRelayCredentialOverNats(request)(true)).toEqual(GRANT);
    const [subject, data] = request.mock.calls[0] ?? [];
    expect(subject).toBe("engine.relay.credential");
    expect(JSON.parse(new TextDecoder().decode(data))).toEqual({ force: true });
  });

  it("returns null when nothing routes through a companion", async () => {
    expect(await requestRelayCredentialOverNats(async () => encode({ relay: null }))(false)).toBeNull();
  });

  it("throws on an error or a malformed reply", async () => {
    for (const body of [{ error: "dashboard answered HTTP 503" }, {}, { relay: { ...GRANT, credential: "x" } }, 7]) {
      await expect(requestRelayCredentialOverNats(async () => encode(body))(false)).rejects.toThrow();
    }
  });
});
