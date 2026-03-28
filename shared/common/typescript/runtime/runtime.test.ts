import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Application, ServicesRegistry } from "./application";
import { createApplication } from "./application";
import type { RuntimeEnvResult } from "./config";
import { createRuntime } from "./runtime";
import type { Service } from "./service";

const emptyEnvSchema = z.object({}).passthrough();

type TestContext = {
  services: ServicesRegistry;
  config?: { config: Record<string, unknown>; getConfig: (key: string) => unknown };
};

function createMockService(name: string, type: string, options?: { failConnect?: boolean; failDisconnect?: boolean }): Service<null> {
  let connected = false;
  return {
    name,
    type,
    healthcheck: false,
    client: null,
    get connected() {
      return connected;
    },
    async connect() {
      if (options?.failConnect) {
        throw new Error(`Simulated connect failure: ${name}`);
      }
      connected = true;
    },
    async disconnect() {
      if (options?.failDisconnect) {
        throw new Error(`Simulated disconnect failure: ${name}`);
      }
      connected = false;
    },
  };
}

function createMockApplication(options?: {
  failInit?: boolean;
  failRun?: boolean;
  failTerminate?: boolean;
  trackCalls?: { init: number; run: number; terminate: number };
}): { app: Application<TestContext>; context: TestContext } {
  const track = options?.trackCalls ?? { init: 0, run: 0, terminate: 0 };
  const context: TestContext = {
    services: {},
  };
  const instance = {
    context,
    async init() {
      track.init++;
      if (options?.failInit) {
        throw new Error("Simulated init failure");
      }
    },
    async run() {
      track.run++;
      if (options?.failRun) {
        throw new Error("Simulated run failure");
      }
    },
    async terminate() {
      track.terminate++;
      if (options?.failTerminate) {
        throw new Error("Simulated terminate failure");
      }
    },
  };
  const app = createApplication(instance);
  return { app, context };
}

function createMockHealthMonitor(options?: {
  failStart?: boolean;
  failLiveness?: boolean;
  failHealthCheck?: boolean;
}): {
  liveness: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  heartbeat: () => Promise<void>;
  healthCheck: () => Promise<boolean>;
} {
  return {
    async start() {
      if (options?.failStart) {
        throw new Error("Simulated health monitor start failure");
      }
    },
    async stop() {},
    async liveness() {
      if (options?.failLiveness) {
        throw new Error("Simulated liveness failure");
      }
    },
    async heartbeat() {},
    async healthCheck() {
      if (options?.failHealthCheck) {
        return false;
      }
      return true;
    },
  };
}

describe("Runtime lifecycle", () => {
  test("runtime starts, runs application, and stops gracefully", async () => {
    const track = { init: 0, run: 0, terminate: 0 };
    const { app, context } = createMockApplication({ trackCalls: track });
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      initialBackoffMs: 100,
      runtimeEnv: () => ({
        config: {},
        getConfig: () => undefined,
      }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 150));
    expect(track.init).toBe(1);
    expect(track.run).toBe(1);
    await runtime.stop();
    expect(track.terminate).toBe(1);
    expect(runtime.getState().status).toBe("done");
  });

  test("stop() when already terminated is a no-op", async () => {
    const { app } = createMockApplication();
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      initialBackoffMs: 50,
      runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
    });
    runtime.start();
    await runtime.stop();
    await runtime.stop();
    expect(runtime.getState().status).toBe("done");
  });
});

describe("Config and env loading", () => {
  test("runtime loads config from custom runtimeEnv and injects into context", async () => {
    const configMap: Record<string, string | number | boolean> = {
      appName: "test-app",
      logLevel: "debug",
      customVar: "custom",
    };
    const getConfig = (k: string) => configMap[k];
    const { app, context } = createMockApplication();
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      initialBackoffMs: 50,
      runtimeEnv: () => ({
        config: configMap,
        getConfig,
      }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(context.config.config).toEqual(configMap);
    expect(context.config.getConfig("appName")).toBe("test-app");
    await runtime.stop();
  });

  test("runtime uses envSchema to validate and set context.config", async () => {
    const schema = z.object({
      appName: z.string(),
      port: z.number(),
    });
    const configMap = { appName: "myapp", port: 9000 };
    const { app, context } = createMockApplication();
    const runtime = createRuntime({
      application: app,
      initialBackoffMs: 50,
      envSchema: schema,
      runtimeEnv: () => ({
        config: configMap,
        getConfig: (k: string) => configMap[k as keyof typeof configMap],
      }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(context.config.config).toEqual({ appName: "myapp", port: 9000 });
    expect(context.config.getConfig("appName")).toBe("myapp");
    expect(context.config.getConfig("port")).toBe(9000);
    await runtime.stop();
  });

  test("runtime init fails when envSchema validation fails", async () => {
    const schema = z.object({
      requiredField: z.string(),
    });
    const track = { init: 0, run: 0, terminate: 0 };
    const { app } = createMockApplication({ trackCalls: track });
    const runtime = createRuntime({
      application: app,
      initialBackoffMs: 50,
      envSchema: schema,
      runtimeEnv: () => ({
        config: {},
        getConfig: () => undefined,
      }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 200));
    const state = runtime.getState();
    expect(state.status).toBe("done");
    expect(state.value).toBe("terminated");
    expect(track.init).toBe(0);
    expect(track.run).toBe(0);
  });
});

describe("Exponential backoff", () => {
  test("service connect failure triggers backoff and retry", async () => {
    const { app, context } = createMockApplication();
    const failingService = createMockService("nats", "nats", { failConnect: true });
    app.register("nats", failingService);
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      initialBackoffMs: 30,
      runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
    });
    runtime.start();
    const delays: number[] = [];
    const unsub = runtime.subscribe((snapshot: { context?: { backoffDelay?: number }; value?: unknown }) => {
      const delay = snapshot.context?.backoffDelay;
      if (delay != null) delays.push(delay);
    });
    await new Promise((r) => setTimeout(r, 200));
    unsub.unsubscribe();
    await runtime.stop();
    expect(delays.length).toBeGreaterThanOrEqual(1);
    expect(delays.some((d) => d >= 30)).toBe(true);
  });

  test("health monitor init failure triggers backoff and retry", async () => {
    const { app } = createMockApplication();
    const monitor = createMockHealthMonitor({ failStart: true });
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      healthMonitor: monitor,
      initialBackoffMs: 25,
      runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 150));
    const state = runtime.getState();
    const backoff = (state.context as { backoffDelay?: number }).backoffDelay;
    expect(backoff).toBeGreaterThanOrEqual(25);
    await runtime.stop();
  });
});

describe("Health monitor", () => {
  test("health monitor backoff and retry on failed start", async () => {
    let startAttempts = 0;
    const monitor = {
      async start() {
        startAttempts++;
        if (startAttempts < 2) {
          throw new Error("Health monitor not ready");
        }
      },
      async stop() {},
      async liveness() {},
      async heartbeat() {},
      async healthCheck() {
        return true;
      },
    };
    const { app } = createMockApplication();
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      healthMonitor: monitor,
      initialBackoffMs: 20,
      runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(startAttempts).toBeGreaterThanOrEqual(2);
    await runtime.stop();
  });
});

describe("Service failure handling", () => {
  test(
    "when health check fails runtime disconnects and re-enters backoff",
    async () => {
      let healthCheckCount = 0;
      const monitor = createMockHealthMonitor({
        failHealthCheck: false,
      });
      const realHealthCheck = monitor.healthCheck.bind(monitor);
      const failingMonitor = {
        ...monitor,
        async healthCheck(services: ServicesRegistry) {
          healthCheckCount++;
          if (healthCheckCount >= 2) {
            return false;
          }
          return realHealthCheck(services);
        },
      };
      const { app } = createMockApplication();
      const svc = createMockService("db", "db");
      app.register("db", svc);
      const runtime = createRuntime({
        application: app,
        envSchema: emptyEnvSchema,
        healthMonitor: failingMonitor,
        initialBackoffMs: 30,
        runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
      });
      runtime.start();
      await new Promise((r) => setTimeout(r, 6000));
      expect(healthCheckCount).toBeGreaterThanOrEqual(1);
      await runtime.stop();
    },
    { timeout: 10000 }
  );
});

describe("Registered service injection", () => {
  test("registered service is available on application context", async () => {
    const { app, context } = createMockApplication();
    const dbService = createMockService("db", "database");
    app.register("db", dbService);
    expect(context.services["db"]).toBe(dbService);
    expect(context.services["db"].name).toBe("db");
    expect(context.services["db"].type).toBe("database");
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      initialBackoffMs: 50,
      runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(context.services["db"].connected).toBe(true);
    await runtime.stop();
    expect(context.services["db"].connected).toBe(false);
  });

  test("multiple registered services are all injected and connected", async () => {
    const { app, context } = createMockApplication();
    const a = createMockService("a", "typeA");
    const b = createMockService("b", "typeB");
    app.register("a", a);
    app.register("b", b);
    const runtime = createRuntime({
      application: app,
      envSchema: emptyEnvSchema,
      initialBackoffMs: 50,
      runtimeEnv: () => ({ config: {}, getConfig: () => undefined }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(context.services["a"].connected).toBe(true);
    expect(context.services["b"].connected).toBe(true);
    await runtime.stop();
  });
});

describe("Env and config injection by type", () => {
  test("config from runtimeEnv is on context and getConfig works by key", async () => {
    const config: Record<string, string | number | boolean> = {
      appName: "woof",
      port: 8080,
      other: "x",
    };
    const { app, context } = createMockApplication();
    const runtime = createRuntime({
      application: app,
      envSchema: z.object({ appName: z.string(), port: z.number(), other: z.string().optional() }).passthrough(),
      initialBackoffMs: 50,
      runtimeEnv: () => ({
        config,
        getConfig: (key: string) => config[key],
      }),
    });
    runtime.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(context.config.getConfig("appName")).toBe("woof");
    expect(context.config.getConfig("port")).toBe(8080);
    expect(context.config.config?.appName).toBe("woof");
    expect(context.config.config?.port).toBe(8080);
    await runtime.stop();
  });
});
