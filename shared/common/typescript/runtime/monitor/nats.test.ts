import { describe, expect, test } from "bun:test";
import type { Service } from "../service";
import { createNATSMonitor } from "./nats";

const natsClient = {
  publish: () => {},
  subscribe: async () => ({ unsubscribe: () => {} }),
};

function service(name: string, healthcheck: Service<null>["healthcheck"]): Service<null> {
  return {
    name,
    type: "test",
    healthcheck,
    client: null,
    connected: true,
    connect: async () => {},
    disconnect: async () => {},
  };
}

describe("createNATSMonitor healthCheck", () => {
  test("calls each function-valued healthcheck and passes when all pass", async () => {
    const monitor = createNATSMonitor({ natsClient, applicationName: "test" });
    let calls = 0;
    const db = service("db", async () => {
      calls++;
      return true;
    });

    expect(await monitor.healthCheck({ db, bus: service("bus", false) })).toBe(true);
    expect(calls).toBe(1);
  });

  test("fails when a function-valued healthcheck reports unhealthy", async () => {
    const monitor = createNATSMonitor({ natsClient, applicationName: "test" });
    const db = service("db", async () => false);

    expect(await monitor.healthCheck({ db, bus: service("bus", false) })).toBe(false);
  });
});
