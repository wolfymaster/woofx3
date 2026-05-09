import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { EngineEventType, type ModuleStorageChangedEvent } from "@woofx3/api/webhooks";
import type { WebhookClient } from "./webhook-client";

// Wildcard subject pattern emitted by the QuickJS / Lua sandbox after a
// successful `ctx.storage.set()`. Concrete subjects are
// `module.storage.<moduleId>.changed`. Mirror of the constant in
// shared/common/golang/cloudevents/subjects.go.
const SUBJECT_MODULE_STORAGE_CHANGED_PATTERN = "module.storage.*.changed";

interface CloudEventEnvelope<T> {
  specversion?: string;
  type?: string;
  source?: string;
  id?: string;
  time?: string;
  data?: T;
  [key: string]: unknown;
}

interface StorageChangedData {
  moduleId?: unknown;
  key?: unknown;
  value?: unknown;
  previousValue?: unknown;
  occurredAt?: unknown;
}

/**
 * Bridges the engine's NATS-side `module.storage.<moduleId>.changed`
 * events out to the registered Convex callback channel as
 * `EngineEventType.MODULE_STORAGE_CHANGED` envelopes. Symmetric with
 * `AlertEmitter` but routes through the Bearer-auth `WebhookClient`
 * (rather than the HMAC-signed alert/OBS channel) since storage events
 * belong to the module-extension webhook contract.
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
      const ce = msg.json() as CloudEventEnvelope<StorageChangedData>;
      event = mapStorageChanged(ce);
    } catch (err) {
      this.logger.error("StorageChangeEmitter: failed to decode CloudEvent", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!event) {
      this.logger.debug("StorageChangeEmitter: dropping malformed payload", {
        subject: msg.subject,
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
 * Decode a `module.storage.changed` CloudEvent envelope into the
 * webhook event shape. Returns null when required fields are missing —
 * the engine should never publish such an envelope, so a null indicates
 * a bug in the producer rather than a legitimate variant.
 *
 * Exported for direct unit testing.
 */
export function mapStorageChanged(
  ce: CloudEventEnvelope<StorageChangedData>
): ModuleStorageChangedEvent | null {
  const data = (ce.data ?? (ce as unknown as StorageChangedData)) as StorageChangedData;
  const moduleId = typeof data.moduleId === "string" ? data.moduleId : "";
  const key = typeof data.key === "string" ? data.key : "";
  if (!moduleId || !key) {
    return null;
  }
  const occurredAt = typeof data.occurredAt === "string" && data.occurredAt
    ? data.occurredAt
    : (typeof ce.time === "string" ? ce.time : new Date().toISOString());

  const event: ModuleStorageChangedEvent = {
    type: EngineEventType.MODULE_STORAGE_CHANGED,
    moduleId,
    key,
    value: data.value,
    occurredAt,
  };
  if (data.previousValue !== undefined) {
    event.previousValue = data.previousValue;
  }
  return event;
}
