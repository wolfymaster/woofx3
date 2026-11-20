import type { HealthMonitor, RequiredServicesProvider } from "../runtime";
import { buildHeartbeat, livenessSubject, readHeartbeat } from "../heartbeat";

export type NATSClient = {
  publish(subject: string, data: Uint8Array): Promise<void> | void;
  subscribe(
    subject: string,
    handler: (msg: { subject: string; data: Uint8Array; json<T = any>(): T; string(): string }) => void
  ): Promise<{ unsubscribe?: () => void } | { unsubscribe: () => void } | any>;
};

export interface CreateNATSMonitorOptions {
  natsClient: NATSClient;
  applicationName: string;
  heartbeatSubject?: string;
  heartbeatReady?: () => boolean | Promise<boolean>;
  requiredServices?: string[];
}

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function parseJson(data: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return undefined;
  }
}

export function createNATSMonitor(
  options: CreateNATSMonitorOptions
): HealthMonitor & Partial<RequiredServicesProvider> {
  const { natsClient, applicationName, heartbeatSubject = "HEARTBEAT", heartbeatReady, requiredServices } = options;
  if (applicationName === "") {
    throw new Error("createNATSMonitor: applicationName is empty, so its heartbeats would not fit their contract");
  }
  const readyByApp: Record<string, boolean> = {};
  let unsub: (() => void) | undefined;

  return {
    async start() {
      try {
        const sub = await natsClient.subscribe(heartbeatSubject, (msg) => {
          const parsed = readHeartbeat(parseJson(msg.data));
          if (parsed) {
            readyByApp[parsed.application] = parsed.ready;
          }
        });
        unsub = typeof sub?.unsubscribe === "function" ? sub.unsubscribe.bind(sub) : undefined;
      } catch (err) {
        console.warn("Failed to subscribe to health monitor heartbeat:", err);
      }
    },
    async stop() {
      const unsubToCall = unsub;
      unsub = undefined;
      if (unsubToCall && typeof unsubToCall === "function") {
        try {
          unsubToCall();
        } catch (e) {
          console.warn("Error calling unsubscribe (client may not have connected):", e);
        }
      }
    },
    async liveness() {
      try {
        await Promise.resolve(natsClient.publish(livenessSubject(applicationName), encode("ping")));
      } catch (e) {
        // Ignore liveness errors - NATS may be disconnected during shutdown
      }
    },
    async heartbeat() {
      try {
        const ready = (await Promise.resolve(heartbeatReady?.())) ?? false;
        const event = buildHeartbeat(applicationName, ready, new Date());
        await Promise.resolve(natsClient.publish(heartbeatSubject, encode(event)));
      } catch (e) {
        // Ignore heartbeat errors - NATS may be disconnected during shutdown
      }
    },
    async healthCheck(services: Record<string, unknown>) {
      const dependencyNames = Object.values(services)
        .filter(
          (d): d is { name: string; healthcheck: () => Promise<boolean> } =>
            d !== null && typeof d === "object" && "healthcheck" in d && typeof (d as any).healthcheck === "function"
        )
        .map((d) => d.name);
      const checks = await Promise.all(
        dependencyNames.map(async (dep) => {
          const svc = services[dep] as { healthcheck?: () => Promise<boolean> } | undefined;
          if (svc?.healthcheck) {
            return svc.healthcheck();
          }
          return readyByApp[dep] === true;
        })
      );
      return checks.every((ok) => ok === true);
    },
    ...(requiredServices != null && requiredServices.length > 0 ? { requiredServices: () => requiredServices } : {}),
  };
}
