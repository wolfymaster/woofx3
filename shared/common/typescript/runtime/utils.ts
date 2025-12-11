import type { Service } from "./service";

type NATSClient = {
  publish(subject: string, data: Uint8Array): Promise<void> | void;
  subscribe(
    subject: string,
    handler: (msg: { subject: string; data: Uint8Array; json<T = any>(): T; string(): string }) => void
  ): Promise<{ unsubscribe?: () => void } | { unsubscribe: () => void } | any>;
};


function toUint8(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

type HeartbeatData = { application: string; ready: boolean };
function parseHeartbeatEvent(payload: any): HeartbeatData | undefined {
  if (!payload) return undefined;
  const data = payload.data ?? payload;
  if (typeof data !== "object" || data == null) return undefined;
  const app = (data.application ?? data.app ?? data.name) as string | undefined;
  const ready = Boolean((data.ready as any) ?? false);
  if (!app) return undefined;
  return { application: app, ready };
}

function fromUint8(u8: Uint8Array): any {
  try {
    return JSON.parse(new TextDecoder().decode(u8));
  } catch {
    return undefined;
  }
}

/**
 * Creates a heartbeat function that publishes heartbeat messages to NATS.
 * This should be passed to ApplicationRuntime as the heartbeat option.
 */
export function createNATSHeartbeat(
  natsClient: NATSClient,
  applicationName: string,
  heartbeatSubject: string = "HEARTBEAT",
  heartbeatReady?: () => boolean | Promise<boolean>
): () => Promise<void> {
  return async () => {
      const ready = (await Promise.resolve(heartbeatReady?.())) ?? false;
      const event = {
        specversion: "1.0",
        type: "com.woofx3.heartbeat",
        source: applicationName,
        subject: heartbeatSubject,
        time: new Date().toISOString(),
        data: { application: applicationName, ready },
      };
      await Promise.resolve(natsClient.publish(heartbeatSubject, toUint8(event)));
  };
}

/**
 * Creates a health check function that subscribes to heartbeat messages and checks dependency health.
 * This should be passed to ApplicationRuntime as the healthCheck option.
 */
export function createNATSHealthCheck(
  natsClient: NATSClient,
  heartbeatSubject: string = "HEARTBEAT"
): (services: Record<string, Service<unknown>>) => Promise<boolean> {
  let isSubscribed = false;
  const readyByApp: Record<string, boolean> = {};

  return async (services: Record<string, Service<unknown>>) => {
    // Subscribe to heartbeats if not already subscribed
    if (!isSubscribed) {
      try {
        await natsClient.subscribe(heartbeatSubject, (msg) => {
          const payload = msg.json?.() ?? fromUint8(msg.data);
          const parsed = parseHeartbeatEvent(payload);
          if (parsed) {
            readyByApp[parsed.application] = parsed.ready;
          }
        });
        isSubscribed = true;
      } catch {
        return false;
      }
    }

    // Check if all dependencies are healthy
    const dependencyNames = Object.values(services).filter(d => d.healthcheck).map((d) => d.name);
    const allHealthy = dependencyNames.every((dep) => readyByApp[dep] === true);
    return allHealthy;
  };
}
