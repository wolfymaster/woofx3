import { afterEach, describe, expect, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { newPairingVerifier, pairingVerifierHash } from "@woofx3/api/pairing";
import { type ApiGatewayContract, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { newHttpBatchRpcSession } from "capnweb";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientSessions } from "../src/client-sessions";
import { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";
import { PairingRegistry, pairedClientCreator } from "../src/pairing";
import { DEFAULT_PAIRING_CONFIG } from "../src/pairing-config";
import { resolveRegistrationPolicy } from "../src/registration";

/*
 * Browser pairing end to end over the engine's HTTP transport, with the
 * Origin header a browser sends: start, approve from an existing client,
 * claim, and authenticate with what the claim returned.
 */

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;
const ORIGIN = "http://localhost:5173";

type Server = ReturnType<typeof createHttpServer>;
let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

interface StoredClient {
  secret: string;
  description: string;
  kind: string;
  origin: string;
}

/** An engine whose db-proxy knows one registered client, `desktop`, and creates the clients pairing asks for. */
function engine(pairs: boolean) {
  const clients = new Map<string, StoredClient>([
    ["desktop", { secret: "desktop-secret", description: "desktop", kind: "CLIENT_KIND_REGISTERED", origin: "" }],
  ]);
  const db = {
    async createClient(request: { description: string; kind: string; origin: string }) {
      const clientId = crypto.randomUUID();
      const secret = crypto.randomUUID();
      clients.set(clientId, { secret, ...request });
      return { status: { code: "OK" }, client: { clientId, clientSecret: secret } };
    },
    async validateClient(clientId: string, clientSecret: string) {
      const client = clients.get(clientId);
      if (!client || client.secret !== clientSecret) {
        return { status: { code: "NOT_FOUND" } };
      }
      return {
        status: { code: "OK" },
        client: { description: client.description, kind: client.kind, origin: client.origin },
      };
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
  const pairing = pairs
    ? new PairingRegistry({
        config: DEFAULT_PAIRING_CONFIG,
        logger,
        createPairedClient: pairedClientCreator(db as never),
        emit: () => {},
        isListedOrigin: () => false,
        loopbackPairsUnlisted: true,
      })
    : null;
  if (pairing) {
    api.setPairingRegistry(pairing);
  }
  const gateway = new ApiGateway(
    api,
    new ClientAuth(db as never, logger),
    db as never,
    logger,
    resolveRegistrationPolicy({}),
    new ClientSessions(logger),
    pairing
  );
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({}) as never,
    health: () => ({}) as never,
    logger,
    gateway,
    requestGuard: { allowedHosts: null, allowedOrigins: null },
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
  });
  const url = `http://127.0.0.1:${server.port}/api`;
  return {
    clients,
    /** One HTTP batch to the gateway, sent with `origin` as its Origin header, or none. */
    gateway(origin: string | null) {
      const headers: Record<string, string> = origin === null ? {} : { Origin: origin };
      return newHttpBatchRpcSession<ApiGatewayContract>(new Request(url, { headers }));
    },
    /** One HTTP batch as an authenticated client. */
    session(clientId: string, secret: string, origin: string | null = null) {
      return this.gateway(origin).authenticate(clientId, secret) as unknown as Woofx3EngineApi;
    },
  };
}

describe("pairing a browser", () => {
  test("from start to an authenticated session bound to the browser's origin", async () => {
    const e = engine(true);
    expect<unknown>(await e.gateway(ORIGIN).ping()).toEqual({ status: "ok", pairing: "available" });

    const verifier = newPairingVerifier();
    const start = await e.gateway(ORIGIN).startPairing({
      description: "Chrome on Windows",
      verifierHash: await pairingVerifierHash(verifier),
    });
    if (!start.ok) {
      throw new Error(`start refused: ${start.code}`);
    }
    const { pairingId, userCode } = start.pairing;

    const looked = await e.session("desktop", "desktop-secret").lookupPairing({ userCode });
    expect(looked).toMatchObject({
      ok: true,
      pairing: { pairingId, origin: ORIGIN, description: "Chrome on Windows" },
    });
    expect(await e.session("desktop", "desktop-secret").decidePairing({ pairingId, decision: "approve" })).toEqual({
      ok: true,
    });

    const claim = await e.gateway(ORIGIN).claimPairing({ pairingId, verifier });
    if (claim.status !== "approved") {
      throw new Error(`claim answered ${claim.status}`);
    }
    const { clientId, clientSecret } = claim.credentials;
    expect(e.clients.get(clientId)).toMatchObject({ kind: "CLIENT_KIND_PAIRED", origin: ORIGIN });

    expect(await e.session(clientId, clientSecret, ORIGIN).ping()).toEqual({ status: "ok" });
    const elsewhere = await e
      .session(clientId, clientSecret, "http://localhost:3000")
      .ping()
      .then(
        () => null,
        (err: unknown) => err
      );
    expect(isAuthenticationRefused(elsewhere)).toBe(true);
  });

  test("the claim must come from the origin that started it", async () => {
    const e = engine(true);
    const verifier = newPairingVerifier();
    const start = await e.gateway(ORIGIN).startPairing({
      description: "Chrome",
      verifierHash: await pairingVerifierHash(verifier),
    });
    if (!start.ok) {
      throw new Error(`start refused: ${start.code}`);
    }
    await e
      .session("desktop", "desktop-secret")
      .decidePairing({ pairingId: start.pairing.pairingId, decision: "approve" });

    expect<unknown>(await e.gateway(null).claimPairing({ pairingId: start.pairing.pairingId, verifier })).toEqual({
      status: "not_found",
    });
    expect<unknown>(
      await e.gateway("http://localhost:3000").claimPairing({ pairingId: start.pairing.pairingId, verifier })
    ).toEqual({
      status: "not_found",
    });
  });

  test("a caller with no Origin cannot start one", async () => {
    const e = engine(true);

    const start = await e.gateway(null).startPairing({
      description: "curl",
      verifierHash: await pairingVerifierHash(newPairingVerifier()),
    });

    expect(start).toMatchObject({ ok: false, code: "origin_refused" });
  });
});

describe("an engine that does not pair", () => {
  test("says so in ping, and refuses every pairing call", async () => {
    const e = engine(false);

    expect<unknown>(await e.gateway(ORIGIN).ping()).toEqual({ status: "ok" });
    expect(
      await e
        .gateway(ORIGIN)
        .startPairing({ description: "Chrome", verifierHash: await pairingVerifierHash(newPairingVerifier()) })
    ).toMatchObject({ ok: false, code: "not_available" });
    expect<unknown>(await e.gateway(ORIGIN).claimPairing({ pairingId: "p", verifier: newPairingVerifier() })).toEqual({
      status: "not_found",
    });
    expect<unknown>(await e.gateway(ORIGIN).cancelPairing({ pairingId: "p", verifier: newPairingVerifier() })).toEqual({
      ok: false,
      code: "not_available",
    });
    const session = () => e.session("desktop", "desktop-secret");
    expect(await session().lookupPairing({ userCode: "BCDF-GHJK" })).toEqual({ ok: false, code: "not_available" });
    expect(await session().decidePairing({ pairingId: "p", decision: "approve" })).toEqual({
      ok: false,
      code: "not_available",
    });
    expect(await session().listPendingPairings()).toEqual({ ok: false, code: "not_available" });
  });
});
