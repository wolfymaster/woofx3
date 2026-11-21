import { buildHeartbeat, readHeartbeat } from "./heartbeat";
import type { Service } from "./service";

function toUint8(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function fromUint8(u8: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(u8));
  } catch {
    return undefined;
  }
}

type NATSClient = {
  publish(subject: string, data: Uint8Array): Promise<void> | void;
  subscribe(
    subject: string,
    handler: (msg: { subject: string; data: Uint8Array; json<T = any>(): T; string(): string }) => void
  ): Promise<{ unsubscribe?: () => void } | { unsubscribe: () => void } | any>;
};

export function createNATSHeartbeat(
  natsClient: NATSClient,
  applicationName: string,
  heartbeatSubject: string = "HEARTBEAT",
  heartbeatReady?: () => boolean | Promise<boolean>
): () => Promise<void> {
  return async () => {
    const ready = (await Promise.resolve(heartbeatReady?.())) ?? false;
    const event = buildHeartbeat(applicationName, ready, new Date());
    await Promise.resolve(natsClient.publish(heartbeatSubject, toUint8(event)));
  };
}

export function createNATSHealthCheck(
  natsClient: NATSClient,
  heartbeatSubject: string = "HEARTBEAT"
): (services: Record<string, Service<unknown>>) => Promise<boolean> {
  let isSubscribed = false;
  const readyByApp: Record<string, boolean> = {};

  return async (services: Record<string, Service<unknown>>) => {
    if (!isSubscribed) {
      try {
        await natsClient.subscribe(heartbeatSubject, (msg) => {
          const parsed = readHeartbeat(fromUint8(msg.data));
          if (parsed) {
            readyByApp[parsed.application] = parsed.ready;
          }
        });
        isSubscribed = true;
      } catch {
        return false;
      }
    }

    const dependencyNames = Object.values(services)
      .filter((d) => d.healthcheck === true)
      .map((d) => d.name);
    const allHealthy = dependencyNames.every((dep) => readyByApp[dep] === true);
    return allHealthy;
  };
}

export type { NATSClient };
