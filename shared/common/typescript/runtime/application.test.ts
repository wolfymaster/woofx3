import { describe, expect, test } from "bun:test";
import type { ServicesRegistry } from "./application";
import { createApplication } from "./application";
import type { Service } from "./service";

type Ctx = { services: ServicesRegistry };

describe("createApplication", () => {
  test("requires context property", () => {
    expect(() =>
      createApplication({
        context: null as any,
        run: () => {},
      } as any)
    ).toThrow("Application class must have a context property");
  });

  test("requires run() method", () => {
    const ctx: Ctx = { services: {} };
    expect(() =>
      createApplication({
        context: ctx,
        run: undefined as any,
      } as any)
    ).toThrow("Application class must implement run(ctx) method");
  });

  test("register adds service to context and getter returns same context", () => {
    const ctx: Ctx = { services: {} };
    const svc = {
      name: "db",
      type: "database",
      healthcheck: false,
      client: null,
      connected: false,
      connect: async () => {},
      disconnect: async () => {},
    } as Service<null>;
    const app = createApplication({
      context: ctx,
      run: () => {},
    } as any);
    app.register("db", svc);
    expect(ctx.services["db"]).toBe(svc);
    expect(app.context.services["db"]).toBe(svc);
  });

  test("register throws if type already registered", () => {
    const ctx: Ctx = { services: {} };
    const svc = {
      name: "x",
      type: "x",
      healthcheck: false,
      client: null,
      connected: false,
      connect: async () => {},
      disconnect: async () => {},
    } as Service<null>;
    const app = createApplication({ context: ctx, run: () => {} } as any);
    app.register("x", svc);
    expect(() => app.register("x", svc)).toThrow("Service with type 'x' is already registered");
  });

  test("init and terminate call optional class methods", async () => {
    let initCalled = false;
    let termCalled = false;
    const ctx: Ctx = { services: {} };
    const app = createApplication({
      context: ctx,
      init: async () => {
        initCalled = true;
      },
      run: () => {},
      terminate: async () => {
        termCalled = true;
      },
    } as any);
    await app.init();
    expect(initCalled).toBe(true);
    await app.terminate();
    expect(termCalled).toBe(true);
  });
});
