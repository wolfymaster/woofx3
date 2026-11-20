import type { WorkflowHealth } from "@woofx3/api";
import {
  EngineEventType,
  type WorkflowHealthChangedEvent,
  type WorkflowHealthSnapshotEvent,
} from "@woofx3/api/webhooks";
import type {
  SchemaWorkflowHealth,
  SchemaWorkflowHealthChangedEvent,
  SchemaWorkflowHealthReply,
  SchemaWorkflowHealthSnapshotEvent,
} from "@woofx3/common/cloudevents/Workflow/workflow.gen";
import {
  validateWorkflowHealthChangedEvent,
  validateWorkflowHealthReply,
  validateWorkflowHealthSnapshotEvent,
} from "@woofx3/common/cloudevents/Workflow/workflow.validate.gen";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { WebhookClient } from "./webhook-client";

// Mirror of the SubjectWorkflowHealth* constants in
// shared/common/golang/cloudevents/subjects.go. The first two are both the
// CloudEvent type and the NATS subject.
export const SUBJECT_WORKFLOW_HEALTH_CHANGED = "workflow.health.changed";
export const SUBJECT_WORKFLOW_HEALTH_SNAPSHOT = "workflow.health.snapshot";
export const SUBJECT_WORKFLOW_HEALTH_GET = "workflow.health.get";

type Validator = ((value: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };

function validationProblem(validate: Validator): string {
  const first = validate.errors?.[0];
  return first ? `${first.instancePath} ${first.message ?? ""}`.trim() : "unknown";
}

/**
 * One health entry as the contract states it. Present-and-empty never happens,
 * so an ok carries no reason and an error carries the engine's own.
 */
function toWorkflowHealth(entry: SchemaWorkflowHealth): WorkflowHealth {
  const health: WorkflowHealth = { workflowId: entry.workflowId, status: entry.status, since: entry.since };
  if (entry.status === "error") {
    // An error the engine could not explain is still an error.
    health.reason = entry.reason ?? "";
  }
  return health;
}

export interface WorkflowHealthReport {
  /** False while the engine is still loading its workflows; the list is then partial. */
  loaded: boolean;
  at: string;
  workflows: WorkflowHealth[];
}

/** Ask the workflow service for its current health. Throws when it does not answer. */
export async function requestWorkflowHealth(nats: NATSClient): Promise<WorkflowHealthReport> {
  const reply = await nats.request(SUBJECT_WORKFLOW_HEALTH_GET, new TextEncoder().encode("{}"));
  const body: unknown = JSON.parse(new TextDecoder().decode(reply.data));
  if (!validateWorkflowHealthReply(body)) {
    throw new Error(
      `workflow service answered a health request against its contract: ${validationProblem(validateWorkflowHealthReply)}`
    );
  }
  const report = body as SchemaWorkflowHealthReply;
  return { loaded: report.loaded, at: report.at, workflows: report.workflows.map(toWorkflowHealth) };
}

/**
 * Forwards the engine's workflow health to every registered client, so a
 * workflow the engine refused to load shows as not running instead of sitting
 * in the list looking fine.
 *
 * Changes and the engine's start-up snapshot are forwarded as they arrive.
 * The api also sends a snapshot of its own when it starts and whenever its
 * bus connection comes back, because events published while it was down or
 * disconnected never reached it, and a client would otherwise keep an error
 * that has since cleared.
 */
export class WorkflowHealthEmitter {
  constructor(
    private nats: NATSClient,
    private webhook: WebhookClient,
    private logger: SharedLogger
  ) {}

  async start(): Promise<void> {
    await this.nats.subscribe(SUBJECT_WORKFLOW_HEALTH_CHANGED, (msg: Msg) => {
      this.handleChanged(msg);
    });
    await this.nats.subscribe(SUBJECT_WORKFLOW_HEALTH_SNAPSHOT, (msg: Msg) => {
      this.handleSnapshot(msg);
    });
    await this.nats.onReconnect(() => {
      void this.resync();
    });
    this.logger.info("WorkflowHealthEmitter started", {
      subjects: [SUBJECT_WORKFLOW_HEALTH_CHANGED, SUBJECT_WORKFLOW_HEALTH_SNAPSHOT],
    });
    void this.resync();
  }

  /**
   * Send clients the engine's current health as a snapshot. Skipped when the
   * engine is unreachable or still loading: its own start-up snapshot follows
   * in that case, and a partial list would clear errors that still hold.
   */
  async resync(): Promise<void> {
    let report: WorkflowHealthReport;
    try {
      report = await requestWorkflowHealth(this.nats);
    } catch (err) {
      this.logger.info("WorkflowHealthEmitter: workflow service did not answer; waiting for its snapshot", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!report.loaded) {
      return;
    }
    this.send({
      type: EngineEventType.WORKFLOW_HEALTH_SNAPSHOT,
      workflows: report.workflows.filter((entry) => entry.status === "error"),
      at: report.at,
    });
  }

  private handleChanged(msg: Msg): void {
    const event = this.decode<SchemaWorkflowHealthChangedEvent>(msg, validateWorkflowHealthChangedEvent);
    if (!event) {
      return;
    }
    this.send({ type: EngineEventType.WORKFLOW_HEALTH_CHANGED, ...toWorkflowHealth(event.data) });
  }

  private handleSnapshot(msg: Msg): void {
    const event = this.decode<SchemaWorkflowHealthSnapshotEvent>(msg, validateWorkflowHealthSnapshotEvent);
    if (!event) {
      return;
    }
    this.send({
      type: EngineEventType.WORKFLOW_HEALTH_SNAPSHOT,
      workflows: event.data.workflows.map(toWorkflowHealth).filter((entry) => entry.status === "error"),
      at: event.data.at,
    });
  }

  /** The message as the contract's type, or null, logged, when it is not JSON or breaks the contract. */
  private decode<T>(msg: Msg, validate: Validator): T | null {
    let body: unknown;
    try {
      body = msg.json();
    } catch (err) {
      this.logger.error("WorkflowHealthEmitter: failed to decode CloudEvent", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!validate(body)) {
      this.logger.warn("WorkflowHealthEmitter: dropping a message that breaks its contract", {
        subject: msg.subject,
        problem: validationProblem(validate),
      });
      return null;
    }
    return body as T;
  }

  private send(event: WorkflowHealthChangedEvent | WorkflowHealthSnapshotEvent): void {
    void this.webhook.send(event).catch((err) => {
      this.logger.error("WorkflowHealthEmitter: webhook delivery threw", {
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
