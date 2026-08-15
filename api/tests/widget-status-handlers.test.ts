import { describe, expect, it } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import { initWidgetStatusHandlers, parseWidgetStatusUpdated } from "../src/widget-status-handlers";

describe("parseWidgetStatusUpdated", () => {
  it("maps snake_case NATS payload to the WidgetStatusChangedEvent shape", () => {
    const event = parseWidgetStatusUpdated({
      application_id: "app-1",
      data: {
        module_id: "mod-1",
        instance_id: "inst-1",
        key: "viewer_count",
        widget_canonical_id: "mod-1:widget:counter",
        occurred_at: "2026-01-01T00:00:00Z",
        value: JSON.stringify({ count: 42 }),
      },
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe(EngineEventType.WIDGET_STATUS_CHANGED);
    expect(event?.applicationId).toBe("app-1");
    expect(event?.moduleId).toBe("mod-1");
    expect(event?.instanceId).toBe("inst-1");
    expect(event?.widgetCanonicalId).toBe("mod-1:widget:counter");
    expect(event?.value).toEqual({ count: 42 });
  });

  it("handles Go PascalCase field names", () => {
    const event = parseWidgetStatusUpdated({
      data: {
        ModuleID: "mod-1",
        InstanceID: "inst-1",
        Key: "viewer_count",
        application_id: "app-1",
        Value: "42",
      },
    });
    expect(event?.value).toBe(42);
  });

  it("falls back to the raw value when it isn't valid JSON", () => {
    const event = parseWidgetStatusUpdated({
      application_id: "app-1",
      data: { module_id: "mod-1", instance_id: "inst-1", key: "k", value: "not-json" },
    });
    expect(event?.value).toBe("not-json");
  });

  it("returns null when moduleId/instanceId/key are missing", () => {
    expect(parseWidgetStatusUpdated({ application_id: "app-1", data: {} })).toBeNull();
  });

  it("returns null when applicationId is missing", () => {
    expect(
      parseWidgetStatusUpdated({ data: { module_id: "mod-1", instance_id: "inst-1", key: "k" } })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initWidgetStatusHandlers — end-to-end subscribe -> parse -> webhook
// wiring, same FakeNatsClient/FakeWebhookClient pattern as
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

describe("initWidgetStatusHandlers", () => {
  it("db.widget_status.updated.* dispatches a WIDGET_STATUS_CHANGED webhook", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initWidgetStatusHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.widget_status.updated.app-1", {
      application_id: "app-1",
      data: { module_id: "mod-1", instance_id: "inst-1", key: "viewer_count", value: "42" },
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe(EngineEventType.WIDGET_STATUS_CHANGED);
  });

  it("does not dispatch when required fields are missing", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initWidgetStatusHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.widget_status.updated.app-1", { application_id: "app-1", data: {} });

    expect(webhook.sentEvents).toHaveLength(0);
  });
});
