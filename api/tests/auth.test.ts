import { describe, expect, mock, test } from "bun:test";
import { CLIENT_AUTH_CACHE_TTL_MS, ClientAuth } from "../src/auth";

const LOGGER = { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;

/** A db-proxy that knows one client, `c1` with secret `right`. */
function db() {
  const validateClient = mock(async (clientId: string, clientSecret: string) => {
    if (clientId === "c1" && clientSecret === "right") {
      return { status: { code: "OK" as const }, client: { description: "desktop" } };
    }
    return { status: { code: "NOT_FOUND" as const, message: "Invalid credentials" } };
  });
  return { validateClient } as unknown as ConstructorParameters<typeof ClientAuth>[0] & {
    validateClient: typeof validateClient;
  };
}

describe("ClientAuth.validate", () => {
  test("accepts known credentials and refuses unknown ones", async () => {
    const auth = new ClientAuth(db(), LOGGER);

    expect(await auth.validate("c1", "right")).toEqual({ kind: "accepted", description: "desktop" });
    expect(await auth.validate("c1", "wrong")).toEqual({ kind: "refused" });
    expect(await auth.validate("c2", "right")).toEqual({ kind: "refused" });
  });

  test.each([
    ["no client id", "", "right"],
    ["no secret", "c1", ""],
  ])("refuses %s without asking db-proxy", async (_, clientId, clientSecret) => {
    const proxy = db();

    expect(await new ClientAuth(proxy, LOGGER).validate(clientId, clientSecret)).toEqual({ kind: "refused" });
    expect(proxy.validateClient).not.toHaveBeenCalled();
  });

  test("a wrong secret does not refuse the right one afterwards", async () => {
    const auth = new ClientAuth(db(), LOGGER);

    await auth.validate("c1", "wrong");

    expect((await auth.validate("c1", "right")).kind).toBe("accepted");
  });

  test("a cached success does not admit another secret", async () => {
    const auth = new ClientAuth(db(), LOGGER);

    await auth.validate("c1", "right");

    expect(await auth.validate("c1", "wrong")).toEqual({ kind: "refused" });
  });

  test("keeps an accepted pair until its time is up", async () => {
    let now = 0;
    const proxy = db();
    const auth = new ClientAuth(proxy, LOGGER, () => now);

    await auth.validate("c1", "right");
    now = CLIENT_AUTH_CACHE_TTL_MS - 1;
    await auth.validate("c1", "right");
    expect(proxy.validateClient).toHaveBeenCalledTimes(1);

    now = CLIENT_AUTH_CACHE_TTL_MS;
    await auth.validate("c1", "right");
    expect(proxy.validateClient).toHaveBeenCalledTimes(2);
  });

  test("a db-proxy that cannot be reached is an error, not a refusal, and is not cached", async () => {
    let reachable = false;
    const proxy = db();
    const real = proxy.validateClient.getMockImplementation();
    proxy.validateClient.mockImplementation(async (clientId: string, clientSecret: string) => {
      if (!reachable) {
        throw new Error("fetch failed");
      }
      return real!(clientId, clientSecret);
    });
    const auth = new ClientAuth(proxy, LOGGER);

    await expect(auth.validate("c1", "right")).rejects.toThrow("fetch failed");

    reachable = true;
    expect((await auth.validate("c1", "right")).kind).toBe("accepted");
  });

  test("a db-proxy answer that is not a verdict is an error", async () => {
    const proxy = {
      validateClient: mock(async () => ({ status: { code: "INTERNAL", message: "database is locked" } })),
    } as unknown as ConstructorParameters<typeof ClientAuth>[0];

    await expect(new ClientAuth(proxy, LOGGER).validate("c1", "right")).rejects.toThrow("INTERNAL");
  });
});
