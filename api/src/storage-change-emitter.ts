import { EngineEventType, type ModuleStorageChangedEvent } from "@woofx3/api/webhooks";
import type { SchemaModuleStorageChangedEvent } from "@woofx3/common/cloudevents/messages.gen";
import { validateModuleStorageChangedEvent } from "@woofx3/common/cloudevents/messages.validate.gen";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { WebhookClient } from "./webhook-client";

// Wildcard subject pattern emitted by the QuickJS / Lua sandbox after a
// successful `ctx.storage.set()`. Concrete subjects are
// `module.storage.<moduleId>.changed`. Mirror of the constant in
// shared/common/golang/cloudevents/subjects.go.
const SUBJECT_MODULE_STORAGE_CHANGED_PATTERN = "module.storage.*.changed";

/**
 * Bridges the engine's NATS-side `module.storage.<moduleId>.changed`
 * events out to the registered Convex callback channel as
 * `EngineEventType.MODULE_STORAGE_CHANGED` envelopes through the
 * Bearer-auth `WebhookClient`.
 */
export class StorageChangeEmitter {
  constructor(
    private nats: NATSClient,
    private webhook: WebhookClient,
    private logger: SharedLogger
  ) {}

  async start(): Promise<void> {
    await this.nats.subscribe(SUBJECT_MODULE_STORAGE_CHANGED_PATTERN, (msg: Msg) => {
      this.handle(msg);
    });
    this.logger.info("StorageChangeEmitter started", {
      subject: SUBJECT_MODULE_STORAGE_CHANGED_PATTERN,
    });
  }

  private handle(msg: Msg): void {
    let event: ModuleStorageChangedEvent | null;
    try {
      event = mapStorageChanged(msg.json<unknown>());
    } catch (err) {
      this.logger.error("StorageChangeEmitter: failed to decode CloudEvent", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!event) {
      this.logger.warn("StorageChangeEmitter: dropping an event that breaks its contract", {
        subject: msg.subject,
        problem: validateModuleStorageChangedEvent.errors?.[0]?.message,
      });
      return;
    }
    void this.webhook.send(event).catch((err) => {
      this.logger.error("StorageChangeEmitter: webhook delivery threw", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Decode a `module.storage.changed` CloudEvent into the webhook event shape.
 * Returns null for an envelope that
 * breaks the contract: the engine never publishes one, so it is a producer bug.
 *
 * Exported for direct unit testing.
 */
export function mapStorageChanged(ce: unknown): ModuleStorageChangedEvent | null {
  if (!validateModuleStorageChangedEvent(ce)) {
    return null;
  }
  const { data } = ce as SchemaModuleStorageChangedEvent;
  return {
    type: EngineEventType.MODULE_STORAGE_CHANGED,
    moduleId: data.moduleId,
    key: data.key,
    value: data.value,
    occurredAt: data.occurredAt,
  };
}
