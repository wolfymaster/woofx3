import { describe, expect, it, mock } from "bun:test";
import type { WorkflowHealth } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Msg } from "@woofx3/nats/src/types";
import { workflowsRoutes } from "../src/routes/workflows";
import { assertValidWorkflowDefinition } from "../src/workflow/validate-definition";
import { parseWorkflowHealth, WorkflowHealthEmitter } from "../src/workflow-health-emitter";

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

describe("parseWorkflowHealth", () => {
  it("decodes an error with its reason", () => {
    expect(
      parseWorkflowHealth({
        workflowId: "wf-1",
        status: "error",
        reason: 'task "t1": unknown action "gone"',
        since: "2026-09-28T12:00:00Z",
      })
    ).toEqual({
      workflowId: "wf-1",
      status: "error",
      reason: 'task "t1": unknown action "gone"',
      since: "2026-09-28T12:00:00Z",
    });
  });

  it("never gives an ok a reason", () => {
    expect(parseWorkflowHealth({ workflowId: "wf-1", status: "ok", reason: "stale", since: "t" })).toEqual({
      workflowId: "wf-1",
      status: "ok",
      since: "t",
    });
  });

  it("keeps an unexplained error rather than dropping it", () => {
    expect(parseWorkflowHealth({ workflowId: "wf-1", status: "error", since: "t" })?.reason).toBe("");
  });

  it("rejects entries the engine never sends", () => {
    expect(parseWorkflowHealth(null)).toBeNull();
    expect(parseWorkflowHealth({ status: "error" })).toBeNull();
    expect(parseWorkflowHealth({ workflowId: "wf-1", status: "degraded" })).toBeNull();
  });
});

describe("WorkflowHealthEmitter", () => {
  function setup() {
    const handlers = new Map<string, (msg: Msg) => void>();
    const nats = {
      subscribe: mock(async (subject: string, handler: (msg: Msg) => void) => {
        handlers.set(subject, handler);
        return {} as any;
      }),
    } as any;
    const webhook = { send: mock(async () => {}) } as any;
    const emitter = new WorkflowHealthEmitter(nats, webhook, fakeLogger());
    return { emitter, webhook, handlers };
  }

  it("forwards a health change to every client as a typed webhook", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();

    handlers.get("workflow.health.changed")!(
      makeMsg("workflow.health.changed", {
        id: "evt-1",
        type: "workflow.health.changed",
        source: "workflow",
        data: { workflowId: "wf-1", status: "error", reason: "broken", since: "2026-09-28T12:00:00Z" },
      })
    );

    expect(webhook.send).toHaveBeenCalledTimes(1);
    const [event, clientId] = webhook.send.mock.calls[0];
    expect(event).toEqual({
      type: EngineEventType.WORKFLOW_HEALTH_CHANGED,
      workflowId: "wf-1",
      status: "error",
      reason: "broken",
      since: "2026-09-28T12:00:00Z",
    });
    expect(clientId).toBeUndefined();
  });

  it("drops a malformed payload without throwing", async () => {
    const { emitter, webhook, handlers } = setup();
    await emitter.start();

    expect(() =>
      handlers.get("workflow.health.changed")!(makeMsg("workflow.health.changed", { data: { status: "error" } }))
    ).not.toThrow();
    expect(webhook.send).not.toHaveBeenCalled();
  });
});

describe("getWorkflowHealth", () => {
  const route = workflowsRoutes.getWorkflowHealth as unknown as () => Promise<WorkflowHealth[]>;

  function host(reply: unknown) {
    const requests: string[] = [];
    return {
      requests,
      ctx: {
        logger: fakeLogger(),
        nats: {
          async request(subject: string) {
            requests.push(subject);
            return { subject, data: new TextEncoder().encode(JSON.stringify(reply)) };
          },
        },
      },
    };
  }

  it("asks the workflow service and returns its entries", async () => {
    const { ctx, requests } = host({
      workflows: [
        { workflowId: "a", status: "error", reason: "broken", since: "2026-09-28T12:00:00Z" },
        { workflowId: "b", status: "ok", since: "2026-09-28T12:00:01Z" },
        { status: "ok" },
      ],
    });

    const health = await route.call(ctx);

    expect(requests).toEqual(["workflow.health.get"]);
    expect(health).toEqual([
      { workflowId: "a", status: "error", reason: "broken", since: "2026-09-28T12:00:00Z" },
      { workflowId: "b", status: "ok", since: "2026-09-28T12:00:01Z" },
    ]);
  });

  it("refuses a reply with no workflow list", async () => {
    const { ctx } = host({});
    await expect(route.call(ctx)).rejects.toThrow("without a workflow list");
  });

  it("refuses without a message bus", async () => {
    await expect(route.call({ logger: fakeLogger(), nats: null })).rejects.toThrow("NATS client not available");
  });
});

describe("assertValidWorkflowDefinition", () => {
  it("carries every reason in the thrown message", () => {
    expect(() =>
      assertValidWorkflowDefinition({
        id: "x",
        name: "X",
        trigger: { type: "event", event: "" },
        tasks: [{ id: "t1", type: "action", action: "" }],
      })
    ).toThrow("Invalid workflow definition: trigger.event: required string; tasks[0].action:");
  });
});
