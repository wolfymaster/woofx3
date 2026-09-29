import type { WorkflowHealth } from "@woofx3/api";
import {
  EngineEventType,
  type WorkflowHealthChangedEvent,
  type WorkflowHealthSnapshotEvent,
} from "@woofx3/api/webhooks";
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

type WarnLogger = Pick<SharedLogger, "warn">;

/**
 * Decode one health entry, from a health CloudEvent's data or from a
 * `workflow.health.get` reply. All share the workflow service's shape, so one
 * decoder keeps the webhooks and the RPC from drifting apart.
 *
 * Returns null for an entry without a workflow id or with a status this does
 * not model: the engine never sends either, so a null is a producer bug.
 */
export function parseWorkflowHealth(raw: unknown, logger: WarnLogger): WorkflowHealth | null {
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
  let since = typeof entry.since === "string" ? entry.since : "";
  if (!since) {
    // The engine always stamps `since`; a missing one is a producer bug, and
    // `now` makes a later change for the same workflow look older than it is.
    logger.warn("workflow health entry without since; using now", { workflowId });
    since = new Date().toISOString();
  }
  const health: WorkflowHealth = { workflowId, status: entry.status, since };
  // An error the engine could not explain is still an error, so the reason is
  // defaulted to empty rather than the entry dropped; an ok never carries one.
  if (health.status === "error") {
    health.reason = typeof entry.reason === "string" ? entry.reason : "";
  }
  return health;
}

function parseEntries(raw: unknown[], logger: WarnLogger): WorkflowHealth[] {
  const out: WorkflowHealth[] = [];
  for (const item of raw) {
    const entry = parseWorkflowHealth(item, logger);
    if (entry) {
      out.push(entry);
    } else {
      logger.warn("dropping malformed workflow health entry", { entry: item });
    }
  }
  return out;
}

export interface WorkflowHealthReport {
  /** False while the engine is still loading its workflows; the list is then partial. */
  loaded: boolean;
  at: string;
  workflows: WorkflowHealth[];
}

/** Ask the workflow service for its current health. Throws when it does not answer. */
export async function requestWorkflowHealth(nats: NATSClient, logger: WarnLogger): Promise<WorkflowHealthReport> {
  const reply = await nats.request(SUBJECT_WORKFLOW_HEALTH_GET, new TextEncoder().encode("{}"));
  const body = JSON.parse(new TextDecoder().decode(reply.data)) as {
    loaded?: unknown;
    at?: unknown;
    workflows?: unknown;
  };
  if (!Array.isArray(body.workflows)) {
    throw new Error("workflow service answered a health request without a workflow list");
  }
  return {
    loaded: body.loaded === true,
    at: typeof body.at === "string" && body.at ? body.at : new Date().toISOString(),
    workflows: parseEntries(body.workflows, logger),
  };
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
      report = await requestWorkflowHealth(this.nats, this.logger);
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
    const data = this.decode(msg);
    if (data === undefined) {
      return;
    }
    const health = parseWorkflowHealth(data, this.logger);
    if (!health) {
      this.logger.warn("WorkflowHealthEmitter: dropping malformed change", { subject: msg.subject });
      return;
    }
    this.send({ type: EngineEventType.WORKFLOW_HEALTH_CHANGED, ...health });
  }

  private handleSnapshot(msg: Msg): void {
    const data = this.decode(msg);
    if (data === undefined) {
      return;
    }
    const snapshot = (data ?? {}) as { workflows?: unknown; at?: unknown };
    if (!Array.isArray(snapshot.workflows)) {
      this.logger.warn("WorkflowHealthEmitter: dropping malformed snapshot", { subject: msg.subject });
      return;
    }
    this.send({
      type: EngineEventType.WORKFLOW_HEALTH_SNAPSHOT,
      workflows: parseEntries(snapshot.workflows, this.logger).filter((entry) => entry.status === "error"),
      at: typeof snapshot.at === "string" && snapshot.at ? snapshot.at : new Date().toISOString(),
    });
  }

  /** The CloudEvent's data (null when absent), or undefined when the message is not JSON. */
  private decode(msg: Msg): unknown {
    try {
      return (msg.json() as { data?: unknown }).data ?? null;
    } catch (err) {
      this.logger.error("WorkflowHealthEmitter: failed to decode CloudEvent", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
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
