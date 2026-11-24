import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type EventCatalog, SubjectSubscriptions } from "./event-catalog";
import type { EventLogSelectionSource } from "./event-log-selection";
import { LEGACY_STREAM_EVENT_TYPES, toFrame } from "./stream-event-broadcaster";
import { ALWAYS_RECORDED_EVENT_TYPES } from "./user-event-recorder";
import type { WebhookClient } from "./webhook-client";

/**
 * Forwards the stream events a dashboard shows to the dashboard's own backend
 * as callbacks, so a hosted dashboard never holds a session to the engine to
 * be pushed them. They travel like every other callback (the event queue, or
 * the webhook route), one `stream.event.pushed` envelope per event.
 *
 * It forwards what the streamer's selection enables, the types always
 * recorded, and the types the dashboard's widgets read whatever the selection
 * (`LEGACY_STREAM_EVENT_TYPES`). The catalog never offers chat, so this is
 * human pace. The dashboard narrows to the types a widget asked for.
 */
export class StreamEventForwarder {
  private subscriptions: SubjectSubscriptions;
  private forwarded: ReadonlySet<string> = new Set();

  constructor(
    nats: NATSClient,
    private webhook: Pick<WebhookClient, "send">,
    private logger: SharedLogger,
    private catalog: EventCatalog,
    private selection: EventLogSelectionSource
  ) {
    this.subscriptions = new SubjectSubscriptions(
      nats,
      (subject, msg) => {
        this.handle(subject, msg);
      },
      logger,
      "StreamEventForwarder"
    );
  }

  async start(): Promise<void> {
    this.selection.onChange((settings) => this.follow(settings.enabled));
    await this.follow(this.selection.settings.enabled);
    this.logger.info("StreamEventForwarder started", { subjects: this.forwarded.size });
  }

  private follow(enabled: readonly string[]): Promise<void> {
    this.forwarded = new Set([...enabled, ...ALWAYS_RECORDED_EVENT_TYPES, ...LEGACY_STREAM_EVENT_TYPES]);
    return this.subscriptions.sync(this.forwarded);
  }

  /** Exposed for tests. */
  handle(subject: string, msg: Msg): void {
    if (!this.forwarded.has(subject)) {
      // Delivered just after its type was turned off.
      return;
    }
    let frame: ReturnType<typeof toFrame>;
    try {
      frame = toFrame(subject, msg.json() as Record<string, unknown>, this.catalog.events.get(subject)?.moduleId);
    } catch (err) {
      this.logger.error("StreamEventForwarder: failed to decode CloudEvent", {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    this.webhook.send({ type: EngineEventType.STREAM_EVENT_PUSHED, frame }).catch((err) => {
      this.logger.warn("StreamEventForwarder: send failed", {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
