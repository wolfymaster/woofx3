// Alert payload + webhook envelope for engine -> Convex delivery.
// See woofx3/browser-source-spec.md for the canonical contract.

import type { OBSCommand } from '../Obs/commands';

export type AlertType =
    | 'follow'
    | 'cheer'
    | 'subscribe'
    | 'sub_gift'
    | 'hypetrain'
    | 'raid'
    | 'stream_online';

export interface AlertContext {
    type: AlertType;
    user: string;
    amount?: number;
    message?: string;
    metadata?: Record<string, unknown>;
}

export type WebhookKind = 'alert' | 'obs_command';

export type WebhookPayload = AlertContext | OBSCommand;

// The on-the-wire envelope POSTed to Convex. Engine generates `eventId` once
// per logical send and reuses it across retries so Convex can deduplicate.
export interface WebhookEnvelope<P extends WebhookPayload = WebhookPayload> {
    eventId: string;
    channelId: string;
    emittedAt: number;
    kind: WebhookKind;
    payload: P;
}

// NATS subject any service can publish to in order to emit an alert intent.
// Reserved for future producers (workflow tasks, modules); not yet wired.
export enum EventType {
    AlertFire = 'engine.alert.fire',
}

export interface AlertFire {
    context: AlertContext;
}
