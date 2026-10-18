import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES, supportedEngineCapabilities, type TwitchHelixResult } from "@woofx3/api";
import { RPC_METHODS } from "../src/api-session";
import { TWITCH_HELIX_TIMEOUT_MS, twitchRoutes } from "../src/routes/twitch";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

interface Asked {
  subject: string;
  body: unknown;
  timeout: number | undefined;
}

/** A bus whose `twitchapi` replier answers with `reply`, or throws it when it is an Error. */
function busAnswering(reply: unknown | Error) {
  const asked: Asked[] = [];
  const nats = {
    async request(subject: string, data: Uint8Array, opts?: { timeout?: number }) {
      asked.push({ subject, body: JSON.parse(new TextDecoder().decode(data)), timeout: opts?.timeout });
      if (reply instanceof Error) {
        throw reply;
      }
      return { subject, data: new TextEncoder().encode(JSON.stringify(reply)) };
    },
  };
  return { nats, asked };
}

function helixResult(data: unknown) {
  return { id: "1", type: "twitchapi.helix.result", source: "twitchapi", time: "", data };
}

function twitchError(error: string, code?: string) {
  return { id: "1", type: "twitchapi.error", source: "twitchapi", time: "", data: code ? { error, code } : { error } };
}

type RouteName = keyof typeof twitchRoutes;

function call(nats: unknown, name: RouteName, ...args: unknown[]): Promise<TwitchHelixResult> {
  const route = twitchRoutes[name] as unknown as (...a: unknown[]) => Promise<TwitchHelixResult>;
  return route.call({ nats, logger: fakeLogger() }, ...args);
}

/** Each route, the arguments a dashboard passes, and the `helix` request it must send. */
const FORWARDS: [RouteName, unknown[], { operation: string; params?: unknown }][] = [
  ["twitchGetChannelInformation", [], { operation: "getChannelInformation" }],
  ["twitchGetGames", [{ id: "509658" }], { operation: "getGames", params: { id: "509658" } }],
  [
    "twitchSearchCategories",
    [{ query: "just chat", first: 10 }],
    { operation: "searchCategories", params: { query: "just chat", first: 10 } },
  ],
  [
    "twitchModifyChannelInformation",
    [{ title: "Late night", game_id: "" }],
    { operation: "modifyChannelInformation", params: { title: "Late night", game_id: "" } },
  ],
  [
    "twitchCreateStreamMarker",
    [{ description: "clutch" }],
    { operation: "createStreamMarker", params: { description: "clutch" } },
  ],
  ["twitchGetAdSchedule", [], { operation: "getAdSchedule" }],
  ["twitchSnoozeNextAd", [], { operation: "snoozeNextAd" }],
];

describe("twitch routes", () => {
  for (const [name, args, expected] of FORWARDS) {
    test(`${name} asks the twitch service for ${expected.operation} and returns Helix's body`, async () => {
      const body = { data: [{ id: "x" }] };
      const { nats, asked } = busAnswering(helixResult({ ok: true, body }));

      expect(await call(nats, name, ...args)).toEqual({ ok: true, body });
      expect(asked).toEqual([
        { subject: "twitchapi", body: { command: "helix", args: expected }, timeout: TWITCH_HELIX_TIMEOUT_MS },
      ]);
    });
  }

  test("covers every route", () => {
    expect(FORWARDS.map(([name]): string => name).sort()).toEqual(Object.keys(twitchRoutes).sort());
  });

  test("waits 10 seconds for the twitch service", () => {
    expect(TWITCH_HELIX_TIMEOUT_MS).toBe(10_000);
  });
});

describe("twitch route results", () => {
  test("a Helix error status is a result carrying Twitch's status, body and reason", async () => {
    const twitchBody = '{"error":"Bad Request","status":400,"message":"The tag contains an invalid character"}';
    const { nats } = busAnswering(helixResult({ ok: false, status: 400, body: twitchBody }));

    expect(await call(nats, "twitchModifyChannelInformation", { tags: ["a-b"] })).toEqual({
      ok: false,
      code: "helix",
      error: "Twitch answered 400: The tag contains an invalid character",
      status: 400,
      body: twitchBody,
    });
  });

  test("a Helix error without a message says only the status", async () => {
    const { nats } = busAnswering(helixResult({ ok: false, status: 502, body: "<html>" }));
    const result = await call(nats, "twitchGetChannelInformation");
    expect(result).toEqual({ ok: false, code: "helix", error: "Twitch answered 502", status: 502, body: "<html>" });
  });

  test("a 204 answer is a null body", async () => {
    const { nats } = busAnswering(helixResult({ ok: true, body: null }));
    expect(await call(nats, "twitchModifyChannelInformation", { title: "x" })).toEqual({ ok: true, body: null });
  });

  test("a timeout is a result, not a thrown error", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    const { nats } = busAnswering(timeout);

    const result = await call(nats, "twitchCreateStreamMarker", {});

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("timeout");
    expect(result.ok === false && result.error).toContain("may still have acted");
  });

  test("no twitch service listening is unavailable", async () => {
    const noResponders = Object.assign(new Error("no responders: 'twitchapi'"), {
      name: "RequestError",
      cause: Object.assign(new Error("no responders"), { name: "NoResponders" }),
    });
    const { nats } = busAnswering(noResponders);

    expect(await call(nats, "twitchGetChannelInformation")).toEqual({
      ok: false,
      code: "unavailable",
      error: "The twitch service is not running",
    });
  });

  test("no message bus is unavailable", async () => {
    const result = await call(null, "twitchGetChannelInformation");
    expect(result.ok === false && result.code).toBe("unavailable");
  });

  test("another bus failure is failed", async () => {
    const { nats } = busAnswering(new Error("NATS connection not available"));
    expect(await call(nats, "twitchGetChannelInformation")).toEqual({
      ok: false,
      code: "failed",
      error: "getChannelInformation: NATS connection not available",
    });
  });

  test("forwards the twitch service's not_linked and invalid_arguments codes", async () => {
    const notLinked = busAnswering(twitchError("Twitch is not linked yet", "not_linked"));
    expect(await call(notLinked.nats, "twitchGetChannelInformation")).toEqual({
      ok: false,
      code: "not_linked",
      error: "Twitch is not linked yet",
    });

    const invalid = busAnswering(twitchError('helix getGames: "id" is required', "invalid_arguments"));
    expect(await call(invalid.nats, "twitchGetGames", {})).toEqual({
      ok: false,
      code: "invalid_arguments",
      error: 'helix getGames: "id" is required',
    });
  });

  test("an uncoded refusal, or one with a code it does not forward, is failed", async () => {
    const uncoded = busAnswering(twitchError("Unknown command: helix"));
    expect(await call(uncoded.nats, "twitchGetChannelInformation")).toEqual({
      ok: false,
      code: "failed",
      error: "Unknown command: helix",
    });

    const other = busAnswering(twitchError("rate limited", "rate_limited"));
    const result = await call(other.nats, "twitchGetChannelInformation");
    expect(result.ok === false && result.code).toBe("failed");
  });

  test("a reply it cannot read is failed", async () => {
    for (const reply of [{ type: "twitchapi.helix.result", data: { ok: "yes" } }, { type: "other" }, 42]) {
      const { nats } = busAnswering(reply);
      const result = await call(nats, "twitchGetChannelInformation");
      expect(result.ok === false && result.code).toBe("failed");
    }
  });

  test("refuses params that are not an object without asking", async () => {
    const { nats, asked } = busAnswering(helixResult({ ok: true, body: null }));

    for (const params of [null, "509658", ["509658"]]) {
      const result = await call(nats, "twitchGetGames", params);
      expect(result.ok === false && result.code).toBe("invalid_arguments");
    }
    expect(asked).toEqual([]);
  });
});

describe("twitch capabilities", () => {
  test("advertises the twitch capabilities, and every twitch route is reachable over RPC", () => {
    expect(supportedEngineCapabilities()).toContain(ENGINE_CAPABILITIES.twitchStreamInfo);
    expect(supportedEngineCapabilities()).toContain(ENGINE_CAPABILITIES.twitchAds);
    const reachable: readonly string[] = RPC_METHODS;
    for (const name of Object.keys(twitchRoutes)) {
      expect(reachable).toContain(name);
    }
  });
});
