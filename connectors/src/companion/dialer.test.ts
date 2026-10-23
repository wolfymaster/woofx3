import { describe, expect, it, mock } from "bun:test";
import type { EngineHosting, RelayConfig } from "@woofx3/api";
import type { RelayGrant } from "@woofx3/common/cloudevents/Relay/relay";
import { OBS_ENDPOINT, obsAdapterFallback } from "../adapters/obs/settings";
import { RELAY_TICKET_TTL_MS } from "../config/companion";
import { emptyEndpointStore, FakeTime, flush, RecordingLogger } from "../host/testing";
import { BridgeOpens } from "./bridge-opens";
import { type DialerDeps, EndpointDialer, type Fetch } from "./dialer";
import type { EndpointStore } from "./endpoint-store";
import { adapterPolicy, type DirectDecision, type RoutePolicy } from "./route-policy";
import type { EndpointResolution } from "./types";

const ORIGIN = "https://c-x.woofx3.tv";
const TICKET = "T".repeat(43);
const CONFIG: RelayConfig = { bridgeOrigin: ORIGIN, endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }] };
const GRANT: RelayGrant = { ...CONFIG, credential: "wfxr1.k1.cGF5bG9hZA.c2ln", expiresAt: 2_000_000_000_000 };
const FALLBACK = obsAdapterFallback({ host: "127.0.0.1", port: "4455", token: "from-config" });
const DIRECT: EndpointResolution = {
  ok: true,
  route: "direct",
  url: "ws://192.168.1.20:4460",
  password: "hunter2",
  address: "192.168.1.20:4460",
};

const store: EndpointStore = {
  ...emptyEndpointStore,
  moduleSettings: async () => [
    { key: "host", value: "192.168.1.20" },
    { key: "port", value: "4460" },
  ],
  moduleSecrets: async () => ({ password: "hunter2" }),
};

const ticketReply = () => Response.json({ ticket: TICKET, expiresInMs: RELAY_TICKET_TTL_MS });

function setup(overrides: Partial<DialerDeps> = {}) {
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const fetchMock = mock<Fetch>(async () => ticketReply());
  const relayCredential = mock(async (_force: boolean): Promise<RelayGrant | null> => GRANT);
  const deps: DialerDeps = {
    relayConfig: async () => null,
    relayCredential,
    fetch: fetchMock,
    opens: new BridgeOpens(8),
    hosting: null,
    ticketTimeoutMs: 5_000,
    timers: time,
    logger,
    ...overrides,
  };
  const dialer = new EndpointDialer(deps);
  // An override replaces the default mock and cap; hand back whichever is in use.
  const inUse = { relayCredential: deps.relayCredential as typeof relayCredential, opens: deps.opens };
  const policy = adapterPolicy({ store, logger });
  const dial = (signal: AbortSignal = new AbortController().signal) =>
    dialer.dial(policy, OBS_ENDPOINT, { signal, fallback: FALLBACK });
  return { dialer, dial, deps, fetchMock, ...inUse, time, logger };
}

const routed = async () => CONFIG;

describe("EndpointDialer route table", () => {
  type Row = {
    name: string;
    hosting: EngineHosting | null;
    listed: boolean;
    credential: "grant" | "null" | "leaves it out" | "none";
    route: "direct" | "companion" | "relay";
    asksCredential: boolean;
  };
  const rows: Row[] = [
    {
      name: "local, listed",
      hosting: "local",
      listed: true,
      credential: "grant",
      route: "direct",
      asksCredential: false,
    },
    {
      name: "local, unlisted",
      hosting: "local",
      listed: false,
      credential: "grant",
      route: "direct",
      asksCredential: false,
    },
  ];
  for (const hosting of ["self", "managed", null] as const) {
    rows.push(
      {
        name: `${hosting}, unlisted`,
        hosting,
        listed: false,
        credential: "grant",
        route: "direct",
        asksCredential: false,
      },
      {
        name: `${hosting}, listed, null answer`,
        hosting,
        listed: true,
        credential: "null",
        route: "direct",
        asksCredential: true,
      },
      {
        name: `${hosting}, listed, a grant that leaves it out`,
        hosting,
        listed: true,
        credential: "leaves it out",
        route: "direct",
        asksCredential: true,
      },
      {
        name: `${hosting}, listed, a grant listing it`,
        hosting,
        listed: true,
        credential: "grant",
        route: "companion",
        asksCredential: true,
      },
      {
        name: `${hosting}, listed, no credential to be had`,
        hosting,
        listed: true,
        credential: "none",
        route: "relay",
        asksCredential: true,
      }
    );
  }

  for (const row of rows) {
    it(`${row.name} -> ${row.route}`, async () => {
      const { dial, relayCredential, fetchMock } = setup({
        hosting: row.hosting,
        relayConfig: async () => (row.listed ? CONFIG : { ...CONFIG, endpoints: [] }),
        relayCredential: mock(async (_force: boolean): Promise<RelayGrant | null> => {
          switch (row.credential) {
            case "grant":
              return GRANT;
            case "null":
              return null;
            case "leaves it out":
              return { ...GRANT, endpoints: [] };
            case "none":
              throw new Error("the api service could not get a relay credential: dashboard answered HTTP 503");
          }
        }),
      });
      const resolution = await dial();
      if (row.route === "relay") {
        expect(resolution).toMatchObject({ ok: false, reason: "relay", address: "c-x.woofx3.tv" });
      } else {
        expect(resolution).toMatchObject({ ok: true, route: row.route });
      }
      if (row.route === "direct") {
        expect(resolution).toEqual(DIRECT);
      }
      expect(fetchMock).toHaveBeenCalledTimes(row.route === "companion" ? 1 : 0);
      expect(relayCredential).toHaveBeenCalledTimes(row.asksCredential ? 1 : 0);
    });
  }
});

describe("EndpointDialer bridge", () => {
  it("exchanges the credential for a ticket and dials the bridge with the endpoint's own password", async () => {
    const { dial, fetchMock } = setup({ relayConfig: routed });
    expect(await dial()).toEqual({
      ok: true,
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
    const { dial, fetchMock } = setup({ relayConfig: routed });
    await dial();
    await dial();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dials the bridge the credential is for, and reports its host when it refuses", async () => {
    const moved = { ...GRANT, bridgeOrigin: "https://c-y.woofx3.tv" };
    const first = setup({ relayConfig: routed, relayCredential: async () => moved });
    expect(await first.dial()).toMatchObject({
      ok: true,
      url: expect.stringMatching(/^wss:\/\/c-y\.woofx3\.tv\/bridge\//),
    });
    const refused = setup({
      relayConfig: routed,
      relayCredential: async () => moved,
      fetch: async () => new Response("no", { status: 503 }),
    });
    expect(await refused.dial()).toMatchObject({ ok: false, reason: "relay", address: "c-y.woofx3.tv" });
  });

  it("renews the credential once when the relay refuses it with 401", async () => {
    const fresh = { ...GRANT, credential: "wfxr1.k1.ZnJlc2g.c2ln" };
    const relayCredential = mock(async (force: boolean) => (force ? fresh : GRANT));
    const fetchMock = mock<Fetch>(async (_url, init) =>
      new Headers(init.headers).get("authorization") === `Bearer ${fresh.credential}`
        ? ticketReply()
        : new Response("no", { status: 401 })
    );
    const { dial } = setup({ relayConfig: routed, relayCredential, fetch: fetchMock });
    expect(await dial()).toMatchObject({ ok: true, route: "companion" });
    expect(relayCredential.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 401", async () => {
    const { dial, relayCredential } = setup({
      relayConfig: routed,
      fetch: async () => new Response("no", { status: 401 }),
    });
    expect(await dial()).toMatchObject({ ok: false, reason: "relay", message: expect.stringContaining("401") });
    expect(relayCredential).toHaveBeenCalledTimes(2);
  });

  for (const status of [403, 404, 502, 503]) {
    it(`answers relay, with no renewal, when the ticket exchange answers ${status}`, async () => {
      const { dial, relayCredential } = setup({
        relayConfig: routed,
        fetch: async () => new Response("no", { status }),
      });
      expect(await dial()).toEqual({
        ok: false,
        reason: "relay",
        message: `the companion relay refused the bridge (${status})`,
        address: "c-x.woofx3.tv",
      });
      expect(relayCredential).toHaveBeenCalledTimes(1);
    });
  }

  it("answers busy when the relay has too many tickets out (429)", async () => {
    const { dial, opens } = setup({
      relayConfig: routed,
      fetch: async () => Response.json({ error: "too_many_tickets" }, { status: 429 }),
    });
    expect(await dial()).toMatchObject({ ok: false, reason: "busy", address: "c-x.woofx3.tv" });
    expect(opens.status().inUse).toBe(0);
  });

  const malformed: Array<[string, Fetch]> = [
    [
      "no answer",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["a short ticket", async () => Response.json({ ticket: "short" })],
    ["no ticket", async () => Response.json({ expiresInMs: 30_000 })],
    ["a body that is not JSON", async () => new Response("not json")],
  ];
  for (const [name, fetchImpl] of malformed) {
    it(`answers relay for ${name}`, async () => {
      const { dial, opens } = setup({ relayConfig: routed, fetch: fetchImpl });
      expect(await dial()).toMatchObject({ ok: false, reason: "relay", address: "c-x.woofx3.tv" });
      expect(opens.status().inUse).toBe(0);
    });
  }

  it("answers relay when the ticket exchange outlives its timeout", async () => {
    const hanging: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { dial, time } = setup({ relayConfig: routed, fetch: hanging });
    const resolving = dial();
    await flush();
    await time.advance(5_000);
    expect(await resolving).toMatchObject({ ok: false, reason: "relay", message: expect.stringContaining("5000ms") });
  });

  describe("when the relay configuration cannot be read", () => {
    const unreadable = async (): Promise<RelayConfig | null> => {
      throw new Error("db-proxy GetSetting: unavailable");
    };

    it("goes direct when the endpoint has a direct route", async () => {
      const { dial, fetchMock } = setup({ relayConfig: unreadable, hosting: "self" });
      expect(await dial()).toEqual(DIRECT);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers store_unreadable when there is no direct route either", async () => {
      const { dialer, logger } = setup({ relayConfig: unreadable, hosting: "self" });
      const broken = adapterPolicy({
        store: {
          ...store,
          moduleSettings: async () => {
            throw new Error("db-proxy: unavailable");
          },
        },
        logger,
      });
      const signal = new AbortController().signal;
      expect(await dialer.dial(broken, OBS_ENDPOINT, { signal })).toMatchObject({
        ok: false,
        reason: "store_unreadable",
      });
    });
  });
});

describe("EndpointDialer policy refusals", () => {
  const fixed = (decision: DirectDecision, directWithoutRelayConfig = true): RoutePolicy => ({
    directWithoutRelayConfig,
    direct: async () => decision,
  });
  const signal = () => new AbortController().signal;

  for (const reason of ["not_declared", "adapter_owned", "protocol_unsupported", "store_unreadable"] as const) {
    it(`never tries the bridge for ${reason}, even when the relay configuration routes the endpoint`, async () => {
      const { dialer, fetchMock, relayCredential } = setup({ relayConfig: routed });
      const refusal: DirectDecision = { ok: false, reason, message: reason };
      expect(await dialer.dial(fixed(refusal), OBS_ENDPOINT, { signal: signal() })).toEqual(refusal);
      expect(relayCredential).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  for (const reason of ["not_routed", "address_refused"] as const) {
    it(`still takes the bridge for ${reason}: only the direct route is missing`, async () => {
      const { dialer } = setup({ relayConfig: routed, hosting: "managed" });
      const refusal: DirectDecision = { ok: false, reason, message: reason };
      expect(await dialer.dial(fixed(refusal), OBS_ENDPOINT, { signal: signal() })).toMatchObject({
        ok: true,
        route: "companion",
      });
    });
  }

  it("answers store_unreadable for a policy that fails closed, even with a direct route", async () => {
    const { dialer } = setup({
      relayConfig: async () => {
        throw new Error("db-proxy GetSetting: unavailable");
      },
      hosting: "local",
    });
    expect(await dialer.dial(fixed(DIRECT as DirectDecision, false), OBS_ENDPOINT, { signal: signal() })).toMatchObject(
      { ok: false, reason: "store_unreadable" }
    );
  });
});

describe("EndpointDialer bridge opens", () => {
  it("holds a permit until the ticket expires, and answers busy past the cap", async () => {
    const { dial, time } = setup({ relayConfig: routed, opens: new BridgeOpens(1) });
    expect(await dial()).toMatchObject({ ok: true, route: "companion" });
    expect(await dial()).toMatchObject({ ok: false, reason: "busy", address: "c-x.woofx3.tv" });
    await time.advance(RELAY_TICKET_TTL_MS);
    expect(await dial()).toMatchObject({ ok: true, route: "companion" });
  });

  it("releases the permit at once when the open fails", async () => {
    const { dial, opens } = setup({
      relayConfig: routed,
      opens: new BridgeOpens(1),
      fetch: async () => new Response("no", { status: 503 }),
    });
    await dial();
    expect(opens.status()).toEqual({ inUse: 0, limit: 1, refused: 0 });
  });

  it("counts refusals, and releases every held permit on stop", async () => {
    const { dial, dialer, opens, time } = setup({ relayConfig: routed, opens: new BridgeOpens(1) });
    await dial();
    await dial();
    expect(opens.status()).toEqual({ inUse: 1, limit: 1, refused: 1 });
    dialer.stop();
    expect(opens.status().inUse).toBe(0);
    expect(time.pending).toBe(0);
  });

  it("never asks for a credential when the cap is reached", async () => {
    const { dial, relayCredential } = setup({ relayConfig: routed, opens: new BridgeOpens(1) });
    await dial();
    await dial();
    expect(relayCredential).toHaveBeenCalledTimes(1);
  });
});

describe("EndpointDialer abort", () => {
  it("rejects with the signal's reason when it is already aborted", async () => {
    const { dial, fetchMock } = setup({ relayConfig: routed });
    const controller = new AbortController();
    controller.abort(new Error("the attempt is over"));
    await expect(dial(controller.signal)).rejects.toThrow("the attempt is over");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("abandons a ticket exchange in flight and releases its permit", async () => {
    const hanging: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { dial, opens, time } = setup({ relayConfig: routed, fetch: hanging });
    const controller = new AbortController();
    const resolving = dial(controller.signal);
    await flush();
    expect(opens.status().inUse).toBe(1);
    controller.abort(new Error("stopped"));
    await expect(resolving).rejects.toThrow("stopped");
    expect(opens.status().inUse).toBe(0);
    expect(time.pending).toBe(0);
  });
});

describe("EndpointDialer on a local engine", () => {
  it("dials a listed endpoint directly, never asks the relay, and warns once", async () => {
    const { dial, logger, relayCredential, fetchMock } = setup({ hosting: "local", relayConfig: routed });
    expect(await dial()).toEqual(DIRECT);
    expect(await dial()).toEqual(DIRECT);
    expect(relayCredential).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const warnings = logger.at("warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("woofx3_obs/obs");
  });

  it("dials directly when the relay configuration cannot be read", async () => {
    const { dial } = setup({
      hosting: "local",
      relayConfig: async () => {
        throw new Error("db down");
      },
    });
    expect(await dial()).toEqual(DIRECT);
  });
});
