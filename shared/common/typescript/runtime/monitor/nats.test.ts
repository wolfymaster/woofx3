import { describe, expect, test } from "bun:test";
import { validateHeartbeatEvent } from "../../cloudevents/messages.validate.gen";
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

describe("createNATSMonitor heartbeats", () => {
  function recordingClient() {
    const published: { subject: string; payload: string }[] = [];
    let deliver: ((data: Uint8Array) => void) | undefined;
    return {
      published,
      deliver: (data: Uint8Array) => deliver?.(data),
      client: {
        publish: (subject: string, data: Uint8Array) => {
          published.push({ subject, payload: new TextDecoder().decode(data) });
        },
        subscribe: async (_subject: string, handler: (msg: { data: Uint8Array }) => void) => {
          deliver = (data) => handler({ data });
          return { unsubscribe: () => {} };
        },
      } as never,
    };
  }

  test("publishes a heartbeat that fits its contract, and liveness apart from it", async () => {
    const bus = recordingClient();
    const monitor = createNATSMonitor({ natsClient: bus.client, applicationName: "api", heartbeatReady: () => true });

    await monitor.heartbeat();
    await monitor.liveness();

    const [beat, ping] = bus.published;
    expect(beat?.subject).toBe("HEARTBEAT");
    expect(validateHeartbeatEvent(JSON.parse(beat?.payload ?? ""))).toBe(true);
    expect(ping?.subject).toBe("_HEALTH.api.ping");
  });

  test("refuses an empty application name", () => {
    expect(() => createNATSMonitor({ natsClient, applicationName: "" })).toThrow("applicationName is empty");
  });
});
