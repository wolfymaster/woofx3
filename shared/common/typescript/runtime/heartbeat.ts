import {
  EventSpecVersion,
  HeartbeatEventSubject,
  HeartbeatEventType,
  type SchemaHeartbeatData as HeartbeatData,
  type SchemaHeartbeatEvent as HeartbeatEvent,
} from "../cloudevents/Heartbeat/heartbeat.gen";
import { validateHeartbeatEvent } from "../cloudevents/Heartbeat/heartbeat.validate.gen";

/**
 * The heartbeat a service publishes on the `HEARTBEAT` subject. Throws when the result does not fit the contract,
 * which can only be an empty application name: the caller is a timer that must not publish a message nobody counts.
 */
export function buildHeartbeat(applicationName: string, ready: boolean, now: Date): HeartbeatEvent {
  const event: HeartbeatEvent = {
    specversion: EventSpecVersion.Value1_0,
    id: crypto.randomUUID(),
    type: HeartbeatEventType.com_woofx3_heartbeat,
    source: applicationName,
    subject: HeartbeatEventSubject.HEARTBEAT,
    time: now.toISOString(),
    data: { application: applicationName, ready },
  };
  if (!validateHeartbeatEvent(event)) {
    const [first] = validateHeartbeatEvent.errors ?? [];
    throw new Error(`heartbeat for "${applicationName}" does not fit its contract: ${first?.message ?? "invalid"}`);
  }
  return event;
}

/** What a heartbeat reports, or undefined for anything on the subject that is not a heartbeat. */
export function readHeartbeat(payload: unknown): HeartbeatData | undefined {
  return validateHeartbeatEvent(payload) ? payload.data : undefined;
}

/** The subject of the connectivity ping a monitor's liveness check publishes; it is not a heartbeat. */
export function livenessSubject(applicationName: string): string {
  return `_HEALTH.${applicationName}.ping`;
}
