import { describe, expect, mock, test } from "bun:test";
import type { RelayConfig, Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";
import { SessionLease } from "../src/client-sessions";
import { forwardRelayConfig } from "../src/routes/relay";

type Responder = (subject: string, body: unknown, timeout: number) => Promise<unknown> | unknown;

/** A bus whose companion gateway answers with `respond`; a thrown error is a request that failed. */
function bus(respond: Responder = () => ({ status: "stored" })) {
  const requests: Array<{ subject: string; body: unknown; timeout: number }> = [];
  const nats = {
    request: mock(async (subject: string, data: Uint8Array, opts: { timeout: number }) => {
      const body: unknown = JSON.parse(new TextDecoder().decode(data));
      requests.push({ subject, body, timeout: opts.timeout });
      const reply = await respond(subject, body, opts.timeout);
      return { data: new TextEncoder().encode(typeof reply === "string" ? reply : JSON.stringify(reply)) };
    }),
  };
  return { nats, requests };
}

function session(respond?: Responder, options: Partial<ApiOptions> = {}) {
  const { nats, requests } = bus(respond);
  const db = { getSetting: mock(async () => null) };
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: nats as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
    ...options,
  });
  return {
    requests,
    db,
    rpc: new ApiSession(api, "dash-client", new SessionLease(() => {})) as unknown as Woofx3EngineApi,
  };
}

const CONFIG: RelayConfig = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
};

describe("setRelayConfig", () => {
  test("forwards the configuration with the session's client id to the companion gateway", async () => {
    const { requests, db, rpc } = session();
    expect(await rpc.setRelayConfig(CONFIG)).toEqual({ ok: true });
    expect(requests).toEqual([
      {
        subject: "engine.companion.relay_config.set",
        body: { config: { ...CONFIG, clientId: "dash-client" } },
        timeout: 5_000,
      },
    ]);
    expect(db.getSetting).not.toHaveBeenCalled();
  });

  test("forwards null to clear the configuration", async () => {
    const { requests, rpc } = session();
    expect(await rpc.setRelayConfig(null)).toEqual({ ok: true });
    expect(requests.map((r) => r.body)).toEqual([{ config: null }]);
  });

  test("waits as long as WOOFX3_COMPANION_REQUEST_TIMEOUT_MS says", async () => {
    const { requests, rpc } = session(undefined, { companionRequestTimeoutMs: 7_000 });
    await rpc.setRelayConfig(null);
    expect(requests[0]?.timeout).toBe(7_000);
  });

  test("refuses a configuration the dialer could not use safely, and forwards nothing", async () => {
    const bad: [unknown, string][] = [
      [{ ...CONFIG, bridgeOrigin: "http://c-abcdefghijkl.woofx3.tv" }, "must be https"],
      [{ ...CONFIG, bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv/bridge" }, "must be an origin"],
      [{ ...CONFIG, bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv?x=1" }, "must be an origin"],
      [{ ...CONFIG, bridgeOrigin: "https://user:pw@c-abcdefghijkl.woofx3.tv" }, "must be an origin"],
      [{ ...CONFIG, bridgeOrigin: "not a url" }, "not a URL"],
      [
        {
          ...CONFIG,
          endpoints: Array.from({ length: 51 }, (_, i) => ({ moduleId: `m${i}`, endpointId: "obs" })),
        },
        "at most 50",
      ],
      [{ ...CONFIG, endpoints: [{ moduleId: "woofx3_obs/..", endpointId: "obs" }] }, "invalid moduleId"],
      [{ ...CONFIG, endpoints: [{ moduleId: ".", endpointId: "obs" }] }, "invalid moduleId"],
      [{ ...CONFIG, endpoints: [{ moduleId: "..", endpointId: "obs" }] }, "invalid moduleId"],
      [{ ...CONFIG, endpoints: [{ moduleId: "woofx3_obs", endpointId: "OBS" }] }, "invalid endpointId"],
      [{ ...CONFIG, endpoints: "woofx3_obs/obs" }, "must be an array"],
    ];
    for (const [config, message] of bad) {
      const { requests, rpc } = session();
      await expect(rpc.setRelayConfig(config as RelayConfig)).rejects.toThrow(message);
      expect(requests).toEqual([]);
    }
  });
});

describe("forwardRelayConfig", () => {
  const STORED = { ...CONFIG, clientId: "dash-client" };
  const PREFIX = "the engine's companion gateway did not store the relay configuration: ";

  test("resolves once the companion gateway answers stored", async () => {
    const { nats } = bus();
    await forwardRelayConfig(nats as never, STORED, 5_000);
  });

  const failures: Array<[name: string, respond: Responder | null, reason: string]> = [
    ["no message bus", null, "the message bus is not connected"],
    [
      "no responder",
      () => {
        throw new Error("503");
      },
      "503",
    ],
    [
      "a timeout",
      () => {
        throw new Error("TIMEOUT");
      },
      "TIMEOUT",
    ],
    ["a failed write", () => ({ status: "failed", error: "db-proxy SetSetting: unavailable" }), "db-proxy SetSetting"],
    ["a reply that is not JSON", () => "{", "its reply is not JSON"],
    ["a malformed reply", () => ({ status: "done" }), "its reply is malformed"],
  ];
  for (const [name, respond, reason] of failures) {
    test(`throws on ${name}`, async () => {
      const nats = respond === null ? null : bus(respond).nats;
      await expect(forwardRelayConfig(nats as never, STORED, 5_000)).rejects.toThrow(`${PREFIX}${reason}`);
    });
  }
});
