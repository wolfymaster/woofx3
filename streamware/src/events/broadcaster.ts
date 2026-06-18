/**
 * Wire types for the `ui.alert.broadcast` / `ui.notify.alert` NATS subjects.
 * The EventBroadcaster class was removed when the overlay moved to the P2
 * channel (StorageBroadcaster.broadcastEvent → /o/{token}/events). These
 * types remain here as they describe the NATS wire format used by both
 * nats-subscriptions.ts and events/handlers.ts.
 */

export interface CloudEventLike {
  id?: string;
  type?: string;
  source?: string;
  time?: string;
  subject?: string;
  data?: Record<string, unknown>;
}

export interface EventPayload {
  id?: string;
  parameters: Record<string, unknown>;
  event: CloudEventLike | null;
}
