import type { WorkflowHealth } from "@woofx3/api";
import { EngineEventType, type WorkflowHealthChangedEvent } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { WebhookClient } from "./webhook-client";

// Mirror of SubjectWorkflowHealthChanged / SubjectWorkflowHealthGet in
// shared/common/golang/cloudevents/subjects.go. The first is both the
// CloudEvent type and the NATS subject.
export const SUBJECT_WORKFLOW_HEALTH_CHANGED = "workflow.health.changed";
export const SUBJECT_WORKFLOW_HEALTH_GET = "workflow.health.get";

/**
 * Decode one health entry, from a `workflow.health.changed` CloudEvent's data
 * or from a `workflow.health.get` reply. Both share the workflow service's
 * shape, so one decoder keeps the webhook and the RPC from drifting apart.
 *
 * Returns null for an entry without a workflow id or with a status this does
 * not model: the engine never sends either, so a null is a producer bug.
 */
export function parseWorkflowHealth(raw: unknown): WorkflowHealth | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const workflowId = typeof entry.workflowId === "string" ? entry.workflowId : "";
  if (!workflowId) {
    return null;
  }
  if (entry.status !== "ok" && entry.status !== "error") {
    return null;
  }
  const health: WorkflowHealth = {
    workflowId,
    status: entry.status,
    since: typeof entry.since === "string" && entry.since ? entry.since : new Date().toISOString(),
  };
  // An error the engine could not explain is still an error, so the reason is
  // defaulted to empty rather than the entry dropped; an ok never carries one.
  if (health.status === "error") {
    health.reason = typeof entry.reason === "string" ? entry.reason : "";
  }
  return health;
}

/**
 * Forwards the engine's workflow health changes to every registered client,
 * so a workflow the engine refused to load shows as not running instead of
 * sitting in the list looking fine.
 *
 * Every change is forwarded, unlike run lifecycle: the workflow service sends
 * one only when a workflow's health actually changes, so this is low volume
 * and each one is something a client should show.
 */
export class WorkflowHealthEmitter {
  constructor(
    private nats: NATSClient,
    private webhook: WebhookClient,
    private logger: SharedLogger
  ) {}

  async start(): Promise<void> {
    await this.nats.subscribe(SUBJECT_WORKFLOW_HEALTH_CHANGED, (msg: Msg) => {
      this.handle(msg);
    });
    this.logger.info("WorkflowHealthEmitter started", { subject: SUBJECT_WORKFLOW_HEALTH_CHANGED });
  }

  private handle(msg: Msg): void {
    let health: WorkflowHealth | null;
    try {
      health = parseWorkflowHealth((msg.json() as { data?: unknown }).data);
    } catch (err) {
      this.logger.error("WorkflowHealthEmitter: failed to decode CloudEvent", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!health) {
      this.logger.warn("WorkflowHealthEmitter: dropping malformed payload", { subject: msg.subject });
      return;
    }

    const event: WorkflowHealthChangedEvent = { type: EngineEventType.WORKFLOW_HEALTH_CHANGED, ...health };
    void this.webhook.send(event).catch((err) => {
      this.logger.error("WorkflowHealthEmitter: webhook delivery threw", {
        workflowId: health.workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
