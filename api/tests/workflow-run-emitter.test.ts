import { describe, expect, it, mock } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Msg } from "@woofx3/nats/src/types";
import { mapWorkflowRun, WorkflowRunEmitter } from "../src/workflow-run-emitter";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function makeMsg(subject: string, body: unknown): Msg {
  const payload = JSON.stringify(body);
  return {
    subject,
    data: new TextEncoder().encode(payload),
    json: () => JSON.parse(payload),
    string: () => payload,
    respond: () => false,
  };
}

function setup() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    subscribe: mock(async (subject: string, handler: (msg: Msg) => void) => {
      handlers.set(subject, handler);
      return {} as any;
    }),
  } as any;
  const webhook = {
    send: mock(async () => {}),
  } as any;
  const emitter = new WorkflowRunEmitter(nats, webhook, fakeLogger());
  return { emitter, nats, webhook, handlers };
}

/** A run event as the engine publishes it: every attribute the contract requires. */
function runEvent(type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: "evt-1", type, source: "workflow", time: "2026-09-17T00:00:00.000Z", ...extra, data };
}

describe("mapWorkflowRun", () => {
  it("decodes a started envelope, carrying the correlation attributes", () => {
    const event = mapWorkflowRun(
      runEvent(
        "workflow.run.started",
        { workflowId: "wf-1", executionId: "ex-1" },
        { triggerId: "corr-1", triggeredBy: "dashboard" }
      )
    );
    expect(event).toEqual({
      type: EngineEventType.WORKFLOW_RUN_STARTED,
      workflowId: "wf-1",
      executionId: "ex-1",
      occurredAt: "2026-09-17T00:00:00.000Z",
      triggerId: "corr-1",
      triggeredBy: "dashboard",
    });
  });

  it("carries the engine's reason on a failure", () => {
    const event = mapWorkflowRun(
      runEvent(
        "workflow.run.failed",
        {
          workflowId: "wf-1",
          executionId: "ex-1",
          error: "alert cannot be published: layout must be an object, got nothing",
        },
        { triggerId: "corr-1" }
      )
    );
    expect(event?.type).toBe(EngineEventType.WORKFLOW_RUN_FAILED);
    expect(event && "error" in event && event.error).toBe(
      "alert cannot be published: layout must be an object, got nothing"
    );
  });

  it("maps a cancellation, carrying the engine's reason", () => {
    const event = mapWorkflowRun(
      runEvent(
        "workflow.run.cancelled",
        { workflowId: "wf-1", executionId: "ex-1", error: "cancelled: from the dashboard" },
        { triggerId: "corr-1" }
      )
    );
    expect(event?.type).toBe(EngineEventType.WORKFLOW_RUN_CANCELLED);
    expect(event && "reason" in event && event.reason).toBe("cancelled: from the dashboard");
    expect(event?.triggerId).toBe("corr-1");
  });

  // The contract makes `error` required on a failure. A run that failed
  // without the engine recording why is still a failure, so it maps rather
  // than being dropped.
  it("maps a failure with no reason to an empty error", () => {
    const event = mapWorkflowRun(runEvent("workflow.run.failed", { workflowId: "wf-1", executionId: "ex-1" }));
    expect(event && "error" in event && event.error).toBe("");
  });

  it("omits correlation attributes entirely when absent", () => {
    const event = mapWorkflowRun(runEvent("workflow.run.completed", { workflowId: "wf-1", executionId: "ex-1" }));
    expect(event && "triggerId" in event).toBe(false);
    expect(event && "triggeredBy" in event).toBe(false);
  });

  it("takes the occurrence time from the envelope", () => {
    const event = mapWorkflowRun(runEvent("workflow.run.completed", { workflowId: "wf-1", executionId: "ex-1" }));
    expect(event?.occurredAt).toBe("2026-09-17T00:00:00.000Z");
  });

  it("returns null without the ids that identify the run", () => {
    expect(mapWorkflowRun(runEvent("workflow.run.started", { executionId: "ex-1" }))).toBeNull();
    expect(mapWorkflowRun(runEvent("workflow.run.started", { workflowId: "wf-1" }))).toBeNull();
  });

  it("returns null for a type it does not model", () => {
    expect(mapWorkflowRun(runEvent("workflow.run.paused", { workflowId: "w", executionId: "e" }))).toBeNull();
  });
});

describe("WorkflowRunEmitter wiring", () => {
  it("subscribes to every lifecycle subject", async () => {
    const { emitter, nats } = setup();
    await emitter.start();
    expect(nats.subscribe).toHaveBeenCalledTimes(4);
    expect(nats.subscribe.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "workflow.run.started",
      "workflow.run.completed",
      "workflow.run.failed",
      "workflow.run.cancelled",
    ]);
  });

  it("forwards a correlated run to webhook.send", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("workflow.run.failed")!(
      makeMsg(
        "workflow.run.failed",
        runEvent(
          "workflow.run.failed",
          { workflowId: "wf-1", executionId: "ex-1", error: "boom" },
          { triggerId: "corr-1" }
        )
      )
    );
    await Promise.resolve();
    expect(webhook.send).toHaveBeenCalledTimes(1);
  });

  // The load-bearing filter: every Twitch event starts a workflow, and
  // forwarding those would be constant traffic landing under no correlation
  // key that no subscriber can read.
  it("drops a run nobody is waiting on", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("workflow.run.started")!(
      makeMsg("workflow.run.started", runEvent("workflow.run.started", { workflowId: "wf-1", executionId: "ex-1" }))
    );
    await Promise.resolve();
    expect(webhook.send).not.toHaveBeenCalled();
  });

  it("drops malformed payloads without calling webhook", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("workflow.run.started")!(
      makeMsg("workflow.run.started", runEvent("workflow.run.started", { workflowId: "wf-1" }))
    );
    await Promise.resolve();
    expect(webhook.send).not.toHaveBeenCalled();
  });

  it("swallows non-JSON payloads", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    const badMsg: Msg = {
      subject: "workflow.run.started",
      data: new TextEncoder().encode("not-json"),
      json: () => {
        throw new Error("invalid json");
      },
      string: () => "not-json",
      respond: () => false,
    };
    expect(() => handlers.get("workflow.run.started")!(badMsg)).not.toThrow();
    await Promise.resolve();
    expect(webhook.send).not.toHaveBeenCalled();
  });
});
