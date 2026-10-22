import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES, supportedEngineCapabilities } from "@woofx3/api";
import {
  type GatewayReply,
  type GatewayRequest,
  PLATFORM_GATEWAY_REPLY_TYPES,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformGatewayResult,
} from "@woofx3/api/platform-gateway";
import type { SharedLogger } from "@woofx3/common/logging";
import { RPC_METHODS } from "../src/api-session";
import { PlatformGatewayClient } from "../src/platform-gateway-client";
import { platformRoutes } from "../src/routes/platform";

function fakeLogger(): SharedLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as SharedLogger;
}

interface Asked {
  subject: string;
  body: unknown;
  timeout: number | undefined;
}

/** A bus whose gateway answers with `reply` (sent raw when it is a string), or throws it when it is an Error. */
function busAnswering(reply: unknown | Error) {
  const asked: Asked[] = [];
  const nats = {
    async request(subject: string, data: Uint8Array, opts?: { timeout?: number }) {
      asked.push({ subject, body: JSON.parse(new TextDecoder().decode(data)), timeout: opts?.timeout });
      if (reply instanceof Error) {
        throw reply;
      }
      const text = typeof reply === "string" ? reply : JSON.stringify(reply);
      return { subject, data: new TextEncoder().encode(text) };
    },
  };
  return { nats, asked };
}

function gatewayReply(data: unknown, type: string = PLATFORM_GATEWAY_REPLY_TYPES.send) {
  return { id: "1", type, source: "connectors", time: "", data };
}

function clientOn(nats: unknown, timeoutMs = 5_000) {
  return new PlatformGatewayClient({ nats: nats as never, logger: fakeLogger(), timeoutMs });
}

const REQUEST: GatewayRequest = {
  action: "chat.send",
  target: { kind: "platforms", ids: ["twitch"] },
  payload: { message: "hi" },
  idempotencyKey: "key-1",
  requestedBy: { kind: "api", ref: "dash-1" },
};

const DELIVERED: GatewayReply = { ok: true, results: { twitch: { status: "delivered", messageId: "m1" } } };

function named(message: string, name: string, cause?: string): Error {
  const err = new Error(message, cause ? { cause: Object.assign(new Error(cause), { name: cause }) } : undefined);
  err.name = name;
  return err;
}

describe("PlatformGatewayClient.send", () => {
  test("sends the bare request on the gateway subject with the configured timeout", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));

    const result = await clientOn(nats, 7_000).send(REQUEST);

    expect(asked).toEqual([{ subject: PLATFORM_GATEWAY_SUBJECTS.send, body: REQUEST, timeout: 7_000 }]);
    expect(result).toEqual({ ok: true, reply: DELIVERED });
  });

  const failures: [string, unknown | Error, PlatformGatewayResult][] = [
    [
      "no responders is unavailable",
      named("503", "NatsError", "NoResponders"),
      { ok: false, code: "unavailable", error: "The platform gateway is not running" },
    ],
    [
      "a timeout says the message may have been sent",
      named("timeout", "TimeoutError"),
      {
        ok: false,
        code: "timeout",
        error: "The platform gateway did not answer within 5s; the message may have been sent",
      },
    ],
    [
      "any other bus error is failed",
      new Error("connection closed"),
      { ok: false, code: "failed", error: "The platform gateway request failed: connection closed" },
    ],
    [
      "a reply that is not JSON is failed",
      "not json",
      { ok: false, code: "failed", error: "The platform gateway sent an unreadable reply" },
    ],
    [
      "a reply of another type is failed",
      gatewayReply(DELIVERED, "platform.gateway.capabilities.result"),
      { ok: false, code: "failed", error: "The platform gateway sent an unexpected reply" },
    ],
    [
      "a reply whose data breaks the contract is failed, naming the field",
      gatewayReply({ ok: true, results: { twitch: { status: "teleported" } } }),
      {
        ok: false,
        code: "failed",
        error: expect.stringContaining("The platform gateway sent an unreadable reply: ") as unknown as string,
      },
    ],
  ];
  for (const [name, reply, expected] of failures) {
    test(name, async () => {
      const { nats } = busAnswering(reply);
      expect(await clientOn(nats).send(REQUEST)).toEqual(expected);
    });
  }

  const warned: [string, unknown | Error][] = [
    ["a timeout", named("timeout", "TimeoutError")],
    ["no responders", named("503", "NatsError", "NoResponders")],
    ["a reply that breaks the contract", "not json"],
  ];
  for (const [name, reply] of warned) {
    test(`${name} is logged with the action and key`, async () => {
      const calls: { message: string; fields: Record<string, unknown> }[] = [];
      const logger = {
        warn: (message: string, fields: Record<string, unknown>) => calls.push({ message, fields }),
      } as unknown as SharedLogger;
      const { nats } = busAnswering(reply);

      await new PlatformGatewayClient({ nats: nats as never, logger, timeoutMs: 5_000 }).send(REQUEST);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.fields).toMatchObject({ action: "chat.send", idempotencyKey: "key-1" });
    });
  }

  test("a refused whole request is still a reply, for the caller to read", async () => {
    const refusal: GatewayReply = {
      ok: false,
      results: {},
      error: { code: "invalid", message: "idempotencyKey was reused" },
    };
    const { nats } = busAnswering(gatewayReply(refusal));
    expect(await clientOn(nats).send(REQUEST)).toEqual({ ok: true, reply: refusal });
  });

  test("an invalid request is refused without asking the gateway", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));
    const bad = { ...REQUEST, payload: { message: "" } } as GatewayRequest;

    const result = await clientOn(nats).send(bad);

    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(asked).toEqual([]);
  });

  test("without a bus the gateway is unavailable", async () => {
    expect(await clientOn(null).send(REQUEST)).toEqual({
      ok: false,
      code: "unavailable",
      error: "The platform gateway cannot be reached: no message bus",
    });
  });

  test.each([0, -1, 1.5, Number.NaN])("refuses a timeout of %p at construction", (timeoutMs) => {
    expect(() => clientOn(null, timeoutMs)).toThrow("timeoutMs must be a positive integer");
  });
});

describe("sendToPlatforms route", () => {
  function call(nats: unknown, params: unknown, context?: { clientId: string }): Promise<PlatformGatewayResult> {
    const host = { platformGateway: clientOn(nats) };
    const route = platformRoutes.sendToPlatforms as unknown as (...a: unknown[]) => Promise<PlatformGatewayResult>;
    return route.call(host, params, context);
  }

  const PARAMS = {
    action: "chat.send",
    platforms: ["twitch"],
    payload: { message: "hi" },
    idempotencyKey: "key-1",
  };

  test("builds a platforms target and attributes the request to the calling session", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));

    const result = await call(nats, PARAMS, { clientId: "dash-1" });

    expect(result).toEqual({ ok: true, reply: DELIVERED });
    expect(asked[0]?.body).toEqual(REQUEST);
  });

  test("passes per-platform options through", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));
    const params = {
      action: "chat.announce",
      platforms: ["twitch"],
      payload: { message: "hi" },
      options: { twitch: { color: "blue" } },
      idempotencyKey: "key-2",
    };

    await call(nats, params, { clientId: "dash-1" });

    expect(asked[0]?.body).toMatchObject({ action: "chat.announce", options: { twitch: { color: "blue" } } });
  });

  test("a caller cannot name who is asking", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));

    await call(nats, { ...PARAMS, requestedBy: { kind: "workflow", ref: "w" } }, { clientId: "dash-1" });

    expect(asked[0]?.body).toMatchObject({ requestedBy: { kind: "api", ref: "dash-1" } });
  });

  test("outcomes of a failed platform come back inside an ok reply", async () => {
    const reply: GatewayReply = { ok: false, results: { twitch: { status: "unavailable", reason: "not_linked" } } };
    const { nats } = busAnswering(gatewayReply(reply));
    expect(await call(nats, PARAMS, { clientId: "dash-1" })).toEqual({ ok: true, reply });
  });

  test("an unknown platform is invalid and never asked", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));
    const result = await call(nats, { ...PARAMS, platforms: ["myspace"] }, { clientId: "dash-1" });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(asked).toEqual([]);
  });

  test("params that are not an object are invalid", async () => {
    const { nats } = busAnswering(gatewayReply(DELIVERED));
    expect(await call(nats, null, { clientId: "dash-1" })).toMatchObject({ ok: false, code: "invalid" });
  });

  test("without a session client id it throws rather than sending an unattributed request", async () => {
    const { nats, asked } = busAnswering(gatewayReply(DELIVERED));
    await expect(call(nats, PARAMS)).rejects.toThrow("needs the session's client id");
    expect(asked).toEqual([]);
  });
});

describe("the platform.gateway capability", () => {
  test("is advertised and its method is on the RPC surface", () => {
    expect(supportedEngineCapabilities(null)).toContain(ENGINE_CAPABILITIES.platformGateway);
    expect(ENGINE_CAPABILITIES.platformGateway).toBe("platform.gateway");
    expect(RPC_METHODS).toContain("sendToPlatforms");
  });
});
