import { describe, expect, test } from "bun:test";
import { isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientSessions } from "../src/client-sessions";
import { ApiGateway } from "../src/gateway";
import type { ConnectionInfo } from "../src/gateway-connection";
import { resolveRegistrationPolicy } from "../src/registration";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;

const PAIRED_FROM = "http://localhost:5173";

/** A gateway whose db-proxy knows `paired`, bound to PAIRED_FROM, and `registered`. */
function gateway() {
  const db = {
    async validateClient(clientId: string) {
      if (clientId === "paired") {
        return {
          status: { code: "OK" },
          client: { description: "Chrome", kind: "CLIENT_KIND_PAIRED", origin: PAIRED_FROM },
        };
      }
      return { status: { code: "OK" }, client: { description: "desktop", kind: "CLIENT_KIND_REGISTERED", origin: "" } };
    },
  };
  const api = new Api({
    db: db as never,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  return new ApiGateway(
    api,
    new ClientAuth(db as never, logger),
    db as never,
    logger,
    resolveRegistrationPolicy({}),
    new ClientSessions(logger)
  );
}

function from(origin: string | null): ConnectionInfo {
  return { origin, remoteAddress: "127.0.0.1", close: null, onEnd() {} };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err
  );
}

describe("authenticating a paired client", () => {
  test.each([
    [PAIRED_FROM],
    ["HTTP://LOCALHOST:5173"],
  ])("is accepted from the origin it paired from (%s)", async (origin) => {
    expect(await rejectionOf(gateway().authenticate("paired", "s", from(origin)))).toBeNull();
  });

  test.each([
    ["another port", "http://localhost:3000"],
    ["another scheme", "https://localhost:5173"],
    ["another host", "http://127.0.0.1:5173"],
    ["the opaque origin", "null"],
    ["no Origin header", null],
  ])("is refused from %s, as wrong credentials are", async (_, origin) => {
    const err = await rejectionOf(gateway().authenticate("paired", "s", from(origin)));

    expect(isAuthenticationRefused(err)).toBe(true);
    expect((err as Error).message).toBe("AuthenticationRefused: Invalid client credentials");
  });
});

describe("authenticating a registered client", () => {
  test.each([
    [PAIRED_FROM],
    ["https://elsewhere.example"],
    [null],
  ])("is accepted from any origin (%s)", async (origin) => {
    expect(await rejectionOf(gateway().authenticate("registered", "s", from(origin)))).toBeNull();
  });
});
