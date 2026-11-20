import type { DatabaseValue } from "@woofx3/api";
import { type DatabaseRecordChangedEvent, EngineEventType } from "@woofx3/api/webhooks";
import type { SchemaDatabaseRecordChangedEvent } from "@woofx3/common/cloudevents/Outbox/outbox.gen";
import { validateDatabaseRecordChangedEvent } from "@woofx3/common/cloudevents/Outbox/outbox.validate.gen";
import type { SharedLogger } from "@woofx3/common/logging";
// stylegate:ignore ANY-LAY-010 reason="@woofx3/nats exports its client type only from src/client, which every projection handler in this service imports"
import type NATSClient from "@woofx3/nats/src/client";
import { subscribeProjections } from "./projection";
import type { WebhookClient } from "./webhook-client";

/**
 * The db proxy publishes `database.record.changed` inside the transaction that
 * changed the row, on the subject equal to the event type. Must match
 * SubjectDatabaseRecordChanged in shared/common/golang/cloudevents/subjects.go.
 */
export const DATABASE_RECORD_CHANGED_SUBJECT = "database.record.changed";

/**
 * The webhook for one outbox row, or null for a row that breaks the contract.
 * Values are not logged: they are public columns, but still a viewer's text.
 */
export function parseDatabaseRecordChanged(ce: unknown): DatabaseRecordChangedEvent | null {
  if (!validateDatabaseRecordChangedEvent(ce)) {
    return null;
  }
  const change = (ce as SchemaDatabaseRecordChangedEvent).data;
  return {
    type: EngineEventType.DATABASE_RECORD_CHANGED,
    ...change,
    publicValues: change.publicValues as Record<string, DatabaseValue> | null,
  };
}

/**
 * Project row changes onto webhooks: Convex keeps the public user page's copy
 * of public columns from them, and the engine event stream carries them to a
 * desktop dashboard.
 */
export async function initDatabaseRecordHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: DATABASE_RECORD_CHANGED_SUBJECT,
      name: DATABASE_RECORD_CHANGED_SUBJECT,
      parse: (ce) => {
        const event = parseDatabaseRecordChanged(ce);
        return event ? { event } : null;
      },
    },
  ]);
}
