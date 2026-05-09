// Module-extension CloudEvents. Currently scoped to persistent-storage
// change notifications emitted by the QuickJS sandbox when a module
// function calls `ctx.storage.set()`. Other module-surface events (widget
// registered/deregistered, etc.) live in `@woofx3/api/webhooks` because
// they are CallbackEnvelope-typed (Bearer-auth webhook channel) rather
// than raw NATS payloads.
//
// Keep the `EventType` strings here in sync with
// `shared/common/golang/cloudevents/subjects.go`.

export enum EventType {
    StorageChanged = 'module.storage.changed',
}

export interface StorageChanged {
    moduleId: string;
    key: string;
    value: unknown;
    previousValue?: unknown;
    occurredAt: string;
}
