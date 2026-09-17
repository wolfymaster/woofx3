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

describe("mapWorkflowRun", () => {
  it("decodes a started envelope, carrying the correlation attributes", () => {
    const event = mapWorkflowRun({
      type: "workflow.run.started",
      time: "2026-09-17T00:00:00.000Z",
      triggerId: "corr-1",
      triggeredBy: "dashboard",
      data: { workflowId: "wf-1", executionId: "ex-1", applicationId: "app-1" },
    });
    expect(event).toEqual({
      type: EngineEventType.WORKFLOW_RUN_STARTED,
      applicationId: "app-1",
      workflowId: "wf-1",
      executionId: "ex-1",
      occurredAt: "2026-09-17T00:00:00.000Z",
      triggerId: "corr-1",
      triggeredBy: "dashboard",
    });
  });

  it("carries the engine's reason on a failure", () => {
    const event = mapWorkflowRun({
      type: "workflow.run.failed",
      time: "2026-09-17T00:00:00.000Z",
      triggerId: "corr-1",
      data: {
        workflowId: "wf-1",
        executionId: "ex-1",
        applicationId: "app-1",
        error: "alert cannot be published: layout must be an object, got nothing",
      },
    });
    expect(event?.type).toBe(EngineEventType.WORKFLOW_RUN_FAILED);
    expect(event && "error" in event && event.error).toBe(
      "alert cannot be published: layout must be an object, got nothing"
    );
  });

  // The contract makes `error` required on a failure. A run that failed
  // without the engine recording why is still a failure, so it maps rather
  // than being dropped.
  it("maps a failure with no reason to an empty error", () => {
    const event = mapWorkflowRun({
      type: "workflow.run.failed",
      data: { workflowId: "wf-1", executionId: "ex-1" },
    });
    expect(event && "error" in event && event.error).toBe("");
  });

  it("omits correlation attributes entirely when absent", () => {
    const event = mapWorkflowRun({
      type: "workflow.run.completed",
      data: { workflowId: "wf-1", executionId: "ex-1" },
    });
    expect(event && "triggerId" in event).toBe(false);
    expect(event && "triggeredBy" in event).toBe(false);
  });

  it("falls back to now when the envelope carries no time", () => {
    const event = mapWorkflowRun({
      type: "workflow.run.completed",
      data: { workflowId: "wf-1", executionId: "ex-1" },
    });
    expect(Number.isNaN(Date.parse(event?.occurredAt ?? ""))).toBe(false);
  });

  it("returns null without the ids that identify the run", () => {
    expect(mapWorkflowRun({ type: "workflow.run.started", data: { executionId: "ex-1" } })).toBeNull();
    expect(mapWorkflowRun({ type: "workflow.run.started", data: { workflowId: "wf-1" } })).toBeNull();
  });

  it("returns null for a type it does not model", () => {
    expect(mapWorkflowRun({ type: "workflow.run.paused", data: { workflowId: "w", executionId: "e" } })).toBeNull();
  });
});

describe("WorkflowRunEmitter wiring", () => {
  it("subscribes to all three lifecycle subjects", async () => {
    const { emitter, nats } = setup();
    await emitter.start();
    expect(nats.subscribe).toHaveBeenCalledTimes(3);
    expect(nats.subscribe.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "workflow.run.started",
      "workflow.run.completed",
      "workflow.run.failed",
    ]);
  });

  it("forwards a correlated run to webhook.send", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("workflow.run.failed")!(
      makeMsg("workflow.run.failed", {
        type: "workflow.run.failed",
        time: "2026-09-17T00:00:00.000Z",
        triggerId: "corr-1",
        data: { workflowId: "wf-1", executionId: "ex-1", applicationId: "app-1", error: "boom" },
      })
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
      makeMsg("workflow.run.started", {
        type: "workflow.run.started",
        data: { workflowId: "wf-1", executionId: "ex-1", applicationId: "app-1" },
      })
    );
    await Promise.resolve();
    expect(webhook.send).not.toHaveBeenCalled();
  });

  it("drops malformed payloads without calling webhook", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();
    handlers.get("workflow.run.started")!(
      makeMsg("workflow.run.started", { type: "workflow.run.started", data: { workflowId: "wf-1" } })
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
