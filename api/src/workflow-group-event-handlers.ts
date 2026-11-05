import type { WorkflowGroup } from "@woofx3/api";
import type {
  WorkflowGroupCreatedEvent,
  WorkflowGroupDeletedEvent,
  WorkflowGroupUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { pickFirst, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
import type { WebhookClient } from "./webhook-client";

/**
 * The `db.workflow_group.{created,updated,deleted}` payload. Must match
 * workflowGroupChangeData in db/app/services/workflow_group_service.go.
 */
interface RawWorkflowGroupRow {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  member_ids?: unknown;
}

function parseGroup(ce: Record<string, unknown>): WorkflowGroup | null {
  const row = readRow<RawWorkflowGroupRow>(ce);
  const id = pickFirst(row.id, ce.entity_id);
  if (id === "" || typeof row.enabled !== "boolean" || !Array.isArray(row.member_ids)) {
    return null;
  }
  return {
    id,
    name: pickFirst(row.name),
    description: pickFirst(row.description),
    enabled: row.enabled,
    memberIds: row.member_ids.filter((x): x is string => typeof x === "string"),
  };
}

export function parseWorkflowGroupCreated(ce: Record<string, unknown>): WorkflowGroupCreatedEvent | null {
  const group = parseGroup(ce);
  return group ? { type: EngineEventType.WORKFLOW_GROUP_CREATED, group } : null;
}

export function parseWorkflowGroupUpdated(ce: Record<string, unknown>): WorkflowGroupUpdatedEvent | null {
  const group = parseGroup(ce);
  return group ? { type: EngineEventType.WORKFLOW_GROUP_UPDATED, group } : null;
}

export function parseWorkflowGroupDeleted(ce: Record<string, unknown>): WorkflowGroupDeletedEvent | null {
  const row = readRow<RawWorkflowGroupRow>(ce);
  const groupId = pickFirst(row.id, ce.entity_id);
  return groupId === "" ? null : { type: EngineEventType.WORKFLOW_GROUP_DELETED, groupId };
}

/**
 * Projects the workflow group outbox onto webhooks, so a change made by any
 * path (including a workflow delete that drops a member) reaches the UI. The
 * api's own group methods also echo the group with the caller's
 * correlationKey; the mirror upserts by id, so the two arriving is harmless.
 */
export async function initWorkflowGroupHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.workflow_group.created.*",
      name: "db.workflow_group.created",
      parse: (ce) => {
        const event = parseWorkflowGroupCreated(ce);
        return event ? { event } : null;
      },
    },
    {
      subject: "db.workflow_group.updated.*",
      name: "db.workflow_group.updated",
      parse: (ce) => {
        const event = parseWorkflowGroupUpdated(ce);
        return event ? { event } : null;
      },
    },
    {
      subject: "db.workflow_group.deleted.*",
      name: "db.workflow_group.deleted",
      parse: (ce) => {
        const event = parseWorkflowGroupDeleted(ce);
        return event ? { event } : null;
      },
    },
  ]);
}
