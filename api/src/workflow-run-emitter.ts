import {
  EngineEventType,
  type WorkflowRunCompletedEvent,
  type WorkflowRunFailedEvent,
  type WorkflowRunStartedEvent,
} from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { WebhookClient } from "./webhook-client";

// Mirror of the constants in shared/common/golang/cloudevents/subjects.go. The
// value is both the CloudEvent type and the NATS subject, so a rename that
// misses one side silently stops forwarding.
const SUBJECT_RUN_STARTED = "workflow.run.started";
const SUBJECT_RUN_COMPLETED = "workflow.run.completed";
const SUBJECT_RUN_FAILED = "workflow.run.failed";

export type WorkflowRunEvent = WorkflowRunStartedEvent | WorkflowRunCompletedEvent | WorkflowRunFailedEvent;

interface RunEnvelope {
  type?: string;
  time?: string;
  triggerId?: unknown;
  triggeredBy?: unknown;
  data?: {
    workflowId?: unknown;
    executionId?: unknown;
    error?: unknown;
  };
}

/**
 * Forwards the engine's workflow run lifecycle out to the Convex callback
 * channel, so a caller that asked for a run can be told how it ended.
 *
 * Publishing an event is asynchronous: the call that triggers a workflow
 * returns as soon as the event reaches the bus, long before any workflow has
 * run. These three events are the only thing that closes that loop.
 *
 * Symmetric with `StorageChangeEmitter`, and routed through the same
 * Bearer-auth `WebhookClient` rather than the HMAC alert channel, because
 * these belong to the typed engine-event webhook contract.
 */
export class WorkflowRunEmitter {
  constructor(
    private nats: NATSClient,
    private webhook: WebhookClient,
    private logger: SharedLogger
  ) {}

  async start(): Promise<void> {
    for (const subject of [SUBJECT_RUN_STARTED, SUBJECT_RUN_COMPLETED, SUBJECT_RUN_FAILED]) {
      await this.nats.subscribe(subject, (msg: Msg) => {
        this.handle(msg);
      });
    }
    this.logger.info("WorkflowRunEmitter started", {
      subjects: [SUBJECT_RUN_STARTED, SUBJECT_RUN_COMPLETED, SUBJECT_RUN_FAILED],
    });
  }

  private handle(msg: Msg): void {
    let event: WorkflowRunEvent | null;
    try {
      event = mapWorkflowRun(msg.json() as RunEnvelope);
    } catch (err) {
      this.logger.error("WorkflowRunEmitter: failed to decode CloudEvent", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!event) {
      this.logger.debug("WorkflowRunEmitter: dropping malformed payload", { subject: msg.subject });
      return;
    }

    // Only runs somebody is waiting on are forwarded. Every Twitch follow and
    // cheer starts a workflow, and pushing three webhooks per run for events
    // nobody asked about would be steady traffic landing under no correlation
    // key, which no consumer can read. A future consumer that wants the whole
    // run history -- a live "recent runs" feed, say -- is the reason to
    // revisit this, and should be a deliberate change rather than a silent one.
    if (!event.triggerId) {
      return;
    }

    void this.webhook.send(event).catch((err) => {
      this.logger.error("WorkflowRunEmitter: webhook delivery threw", {
        subject: msg.subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Decode a workflow run CloudEvent envelope into its webhook event shape.
 *
 * Returns null for an envelope missing the ids that identify the run, and for
 * a type this does not model -- the engine should never publish either, so a
 * null means a producer bug rather than a legitimate variant.
 *
 * Exported for direct unit testing.
 */
export function mapWorkflowRun(ce: RunEnvelope): WorkflowRunEvent | null {
  const data = ce.data ?? {};
  const workflowId = typeof data.workflowId === "string" ? data.workflowId : "";
  const executionId = typeof data.executionId === "string" ? data.executionId : "";
  if (!workflowId || !executionId) {
    return null;
  }

  const common = {
    workflowId,
    executionId,
    // The envelope's own time is the moment the engine decided, which is what
    // a reader wants; `now` is only a fallback for an envelope without one.
    occurredAt: typeof ce.time === "string" && ce.time ? ce.time : new Date().toISOString(),
    ...(typeof ce.triggerId === "string" && ce.triggerId ? { triggerId: ce.triggerId } : {}),
    ...(typeof ce.triggeredBy === "string" && ce.triggeredBy ? { triggeredBy: ce.triggeredBy } : {}),
  };

  switch (ce.type) {
    case SUBJECT_RUN_STARTED:
      return { type: EngineEventType.WORKFLOW_RUN_STARTED, ...common };
    case SUBJECT_RUN_COMPLETED:
      return { type: EngineEventType.WORKFLOW_RUN_COMPLETED, ...common };
    case SUBJECT_RUN_FAILED:
      // Empty rather than absent: the contract makes `error` required on a
      // failure, and a failure the engine could not explain is still a failure.
      return {
        type: EngineEventType.WORKFLOW_RUN_FAILED,
        ...common,
        error: typeof data.error === "string" ? data.error : "",
      };
    default:
      return null;
  }
}
