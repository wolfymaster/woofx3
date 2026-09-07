import { describe, expect, test } from "bun:test";
import { Api } from "../src/api";
import { ApiSession, RPC_METHODS } from "../src/api-session";

/**
 * The type assertions in api-session.ts already tie RPC_METHODS to
 * `keyof Woofx3EngineApi` at compile time. These cover what types cannot:
 * that the prototype a client actually receives matches that list, and that
 * specific internal methods are absent from it.
 *
 * Worth having both. The delegation is a runtime loop over a prototype, so a
 * refactor could satisfy the compiler and still publish the wrong object.
 */
function exposedMethods(): string[] {
  return Object.getOwnPropertyNames(ApiSession.prototype)
    .filter((key) => key !== "constructor")
    .filter((key) => typeof (ApiSession.prototype as unknown as Record<string, unknown>)[key] === "function")
    .sort();
}

describe("the RPC surface a client sees", () => {
  test("is exactly the declared contract", () => {
    expect(exposedMethods()).toEqual([...RPC_METHODS].sort());
  });

  test("does not expose engine wiring", () => {
    // Each of these was reachable by any authenticated client before the
    // surface was pinned. setApplicationId rewrites the process-wide
    // application id and cascades into the webhook client;
    // initSubscriptions duplicates four NATS subscriptions on every call;
    // handleProcessingCallback is barkloader's completion path, which
    // http.ts serves separately and deliberately keeps off capnweb.
    const internal = [
      "setApplicationId",
      "setWebhookClient",
      "setAuthInvalidate",
      "initSubscriptions",
      "handleProcessingCallback",
    ];
    for (const name of internal) {
      expect(exposedMethods()).not.toContain(name);
    }
  });

  test("still carries the wiring on Api itself, where the engine calls it", () => {
    // Hidden from clients, not removed: application.ts drives all of these.
    for (const name of ["setApplicationId", "setWebhookClient", "initSubscriptions", "handleProcessingCallback"]) {
      expect(typeof (Api.prototype as unknown as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("delegates every contract method to the underlying Api", () => {
    const calls: string[] = [];
    const api = new Proxy({} as Api, {
      get(_target, prop: string) {
        return (...args: unknown[]) => {
          calls.push(prop);
          return Promise.resolve(args);
        };
      },
    });
    const session = new ApiSession(api, "client-1");

    for (const name of RPC_METHODS) {
      const method = (session as unknown as Record<string, unknown>)[name];
      expect(typeof method).toBe("function");
    }
    // Sanity-check one pass-through and one clientId-injecting override.
    void (session as unknown as Record<string, (...a: unknown[]) => unknown>).ping();
    void (session as unknown as Record<string, (...a: unknown[]) => unknown>).uninstallModule("mod");
    expect(calls).toContain("ping");
    expect(calls).toContain("uninstallModule");
  });

  test("injects the session clientId rather than trusting the caller", async () => {
    let received: unknown;
    const api = new Proxy({} as Api, {
      get() {
        return (...args: unknown[]) => {
          received = args[args.length - 1];
          return Promise.resolve(undefined);
        };
      },
    });
    const session = new ApiSession(api, "client-42");

    await session.uninstallModule("some-module");

    expect(received).toMatchObject({ clientId: "client-42" });
  });

  test("every method on Api is either published or a known internal", () => {
    // The compile-time assertions stop an undeclared method being *served*,
    // but they cannot see a route method that was added and never declared:
    // it just silently fails to appear. This catches that direction, so the
    // choice is deliberate either way -- declare it, or name it here.
    const INTERNAL = [
      "setApplicationId",
      "setWebhookClient",
      "setAuthInvalidate",
      "initSubscriptions",
      "handleProcessingCallback",
    ].sort();

    const onApi = Object.getOwnPropertyNames(Api.prototype)
      .filter((key) => key !== "constructor")
      .filter((key) => typeof (Api.prototype as unknown as Record<string, unknown>)[key] === "function");
    const undeclared = onApi.filter((key) => !(RPC_METHODS as readonly string[]).includes(key)).sort();

    expect(undeclared).toEqual(INTERNAL);
  });
});
