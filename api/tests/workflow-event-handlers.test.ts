import { describe, expect, test } from "bun:test";
import {
  initWorkflowHandlers,
  parseWorkflowCreated,
  parseWorkflowDeleted,
  parseWorkflowUpdated,
} from "../src/workflow-event-handlers";

const sampleSteps = JSON.stringify([
  {
    id: "alert",
    type: "action",
    action: "function",
    function: "twitch_platform:function:play_alert",
    parameters: { text: "hello" },
    $ref: "twitch_platform:action:play_alert",
  },
]);

const sampleTrigger = JSON.stringify({
  $ref: "twitch_platform:trigger:twitch.channel.follow",
  type: "event",
  event: "twitch.channel.follow",
});

describe("parseWorkflowCreated", () => {
  test("maps Go-cased GORM payload to a workflow.created event", () => {
    const ce = {
      application_id: "app-1",
      client_id: "client-a",
      data: {
        ID: "wf-uuid",
        ApplicationID: "app-1",
        Name: "wolfy_profile/Someone Follows the Stream",
        Steps: sampleSteps,
        Trigger: sampleTrigger,
      },
    };

    const { applicationId, clientId, event } = parseWorkflowCreated(ce);
    expect(applicationId).toBe("app-1");
    expect(clientId).toBe("client-a");
    expect(event).not.toBeNull();
    if (!event) return;
    expect(event.type).toBe("workflow.created");
    expect(event.applicationId).toBe("app-1");
    expect(event.workflow.id).toBe("wf-uuid");
    expect(event.workflow.isEnabled).toBe(false);
    expect(event.workflow.definition?.name).toBe(
      "wolfy_profile/Someone Follows the Stream"
    );
    // The persisted trigger JSON also carries a `$ref` graph-metadata
    // key that isn't on the typed `TriggerConfig` shape; assert via
    // index access so the typed surface stays clean.
    const trigger = event.workflow.definition?.trigger as Record<string, unknown>;
    expect(trigger.type).toBe("event");
    expect(trigger.event).toBe("twitch.channel.follow");
    expect(trigger.$ref).toBe("twitch_platform:trigger:twitch.channel.follow");
    expect(event.workflow.definition?.tasks).toHaveLength(1);
    expect(event.workflow.definition?.tasks?.[0]?.id).toBe("alert");
  });

  test("also accepts snake_case payloads (forward compat)", () => {
    const ce = {
      application_id: "app-1",
      data: {
        id: "wf-2",
        name: "snake",
        steps_json: sampleSteps,
        trigger_json: sampleTrigger,
      },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event).not.toBeNull();
    expect(event?.workflow.id).toBe("wf-2");
    expect(event?.workflow.definition?.name).toBe("snake");
  });

  test("returns null event when trigger JSON is missing", () => {
    const ce = {
      application_id: "app-1",
      data: { ID: "wf-3", Name: "no-trigger", Steps: sampleSteps },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event).toBeNull();
  });

  test("returns null event when id is missing", () => {
    const ce = {
      application_id: "app-1",
      data: { Name: "no-id", Steps: sampleSteps, Trigger: sampleTrigger },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event).toBeNull();
  });

  test("defaults missing extensions to empty strings", () => {
    const ce = {
      data: {
        ID: "wf-4",
        Name: "x",
        Steps: sampleSteps,
        Trigger: sampleTrigger,
      },
    };
    const { applicationId, clientId } = parseWorkflowCreated(ce);
    expect(applicationId).toBe("");
    expect(clientId).toBe("");
  });

  test("threads projection_key onto the snapshot when present", () => {
    const ce = {
      application_id: "app-1",
      data: {
        id: "wf-pk",
        name: "with pk",
        steps_json: sampleSteps,
        trigger_json: sampleTrigger,
        projection_key:
          "wolfy_profile:1.0.0:abc1234:workflow:follow-workflow",
      },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event?.workflow.projectionKey).toBe(
      "wolfy_profile:1.0.0:abc1234:workflow:follow-workflow"
    );
  });

  test("leaves projectionKey undefined when payload omits projection_key", () => {
    const ce = {
      application_id: "app-1",
      data: {
        id: "wf-no-pk",
        name: "user wf",
        steps_json: sampleSteps,
        trigger_json: sampleTrigger,
      },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event?.workflow).not.toHaveProperty("projectionKey");
  });

  test("propagates enabled=true from the publisher payload", () => {
    const ce = {
      application_id: "app-1",
      data: {
        id: "wf-enabled",
        name: "n",
        enabled: true,
        steps_json: sampleSteps,
        trigger_json: sampleTrigger,
      },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event?.workflow.isEnabled).toBe(true);
  });

  test("defaults isEnabled to false when payload omits enabled", () => {
    const ce = {
      application_id: "app-1",
      data: {
        id: "wf-default",
        name: "n",
        steps_json: sampleSteps,
        trigger_json: sampleTrigger,
      },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event?.workflow.isEnabled).toBe(false);
  });

  test("accepts Go-cased Enabled key", () => {
    const ce = {
      application_id: "app-1",
      data: {
        ID: "wf-go-cased",
        Name: "n",
        Enabled: true,
        Steps: sampleSteps,
        Trigger: sampleTrigger,
      },
    };
    const { event } = parseWorkflowCreated(ce);
    expect(event?.workflow.isEnabled).toBe(true);
  });
});

describe("parseWorkflowUpdated", () => {
  test("emits a workflow.updated event with the same shape as created", () => {
    const ce = {
      application_id: "app-1",
      data: {
        ID: "wf-5",
        Name: "updated",
        Steps: sampleSteps,
        Trigger: sampleTrigger,
      },
    };
    const { event } = parseWorkflowUpdated(ce);
    expect(event).not.toBeNull();
    expect(event?.type).toBe("workflow.updated");
    expect(event?.workflow.id).toBe("wf-5");
  });
});

describe("parseWorkflowDeleted", () => {
  test("reads lowercase id from delete payload", () => {
    const ce = {
      application_id: "app-1",
      client_id: "client-z",
      data: { id: "wf-deleted" },
    };
    const { applicationId, clientId, event } = parseWorkflowDeleted(ce);
    expect(applicationId).toBe("app-1");
    expect(clientId).toBe("client-z");
    expect(event).not.toBeNull();
    expect(event?.type).toBe("workflow.deleted");
    expect(event?.workflowId).toBe("wf-deleted");
    expect(event?.applicationId).toBe("app-1");
  });

  test("falls back to entity_id extension if data lacks id", () => {
    const ce = {
      application_id: "app-1",
      entity_id: "wf-from-extension",
      data: {},
    };
    const { event } = parseWorkflowDeleted(ce);
    expect(event?.workflowId).toBe("wf-from-extension");
  });

  test("returns null event when no workflow id is present anywhere", () => {
    const { event } = parseWorkflowDeleted({ application_id: "app-1", data: {} });
    expect(event).toBeNull();
  });

  test("threads projection_key onto the deleted event when present", () => {
    const ce = {
      application_id: "app-1",
      data: {
        id: "wf-deleted",
        projection_key:
          "wolfy_profile:1.0.0:abc1234:workflow:follow-workflow",
      },
    };
    const { event } = parseWorkflowDeleted(ce);
    expect(event?.projectionKey).toBe(
      "wolfy_profile:1.0.0:abc1234:workflow:follow-workflow"
    );
  });

  test("leaves projectionKey undefined on USER-authored workflow deletes", () => {
    const ce = {
      application_id: "app-1",
      data: { id: "user-wf" },
    };
    const { event } = parseWorkflowDeleted(ce);
    expect(event).not.toBeNull();
    expect(event).not.toHaveProperty("projectionKey");
  });
});

// ---------------------------------------------------------------------------
// initWorkflowHandlers — end-to-end subscribe -> parse -> webhook wiring,
// same FakeNatsClient/FakeWebhookClient pattern as
// overlay-token-handlers.test.ts.
// ---------------------------------------------------------------------------

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
  withContext: () => noopLogger,
} as any;

class FakeNatsClient {
  private handlers: Map<string, (msg: { data: Uint8Array; subject: string }) => void | Promise<void>> = new Map();
  async subscribe(
    subject: string,
    handler: (msg: { data: Uint8Array; subject: string }) => void | Promise<void>
  ): Promise<void> {
    this.handlers.set(subject, handler);
  }
  async publish(): Promise<void> {}
  async request(): Promise<{ data: Uint8Array; subject: string }> {
    return { data: new Uint8Array(), subject: "" };
  }
  async dispatch(subject: string, data: Record<string, unknown>): Promise<void> {
    for (const [pattern, handler] of this.handlers) {
      if (subjectMatchesPattern(pattern, subject)) {
        await handler({ data: new TextEncoder().encode(JSON.stringify(data)), subject, json: () => data } as any);
        return;
      }
    }
    throw new Error(`No handler registered for subject: ${subject}`);
  }
}

function subjectMatchesPattern(pattern: string, subject: string): boolean {
  const patternParts = pattern.split(".");
  const subjectParts = subject.split(".");
  if (patternParts.length !== subjectParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] !== "*" && patternParts[i] !== subjectParts[i]) return false;
  }
  return true;
}

class FakeWebhookClient {
  public sentEvents: Array<{ type: string; [key: string]: unknown }> = [];
  async send(event: { type: string; [key: string]: unknown }): Promise<void> {
    this.sentEvents.push(event);
  }
  setApplicationId(): void {}
  async refreshCallbackUrls(): Promise<void> {}
}

describe("initWorkflowHandlers", () => {
  test("db.workflow.created.* dispatches a workflow.created webhook", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initWorkflowHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.workflow.created.app-1", {
      application_id: "app-1",
      data: { ID: "wf-1", ApplicationID: "app-1", Name: "My Workflow", Steps: sampleSteps, Trigger: sampleTrigger },
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe("workflow.created");
  });

  test("db.workflow.deleted.* dispatches a workflow.deleted webhook", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initWorkflowHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.workflow.deleted.app-1", {
      application_id: "app-1",
      data: { id: "wf-1" },
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe("workflow.deleted");
  });

  test("skips the webhook when the payload is missing required fields", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initWorkflowHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.workflow.created.app-1", { application_id: "app-1", data: {} });

    expect(webhook.sentEvents).toHaveLength(0);
  });
});
