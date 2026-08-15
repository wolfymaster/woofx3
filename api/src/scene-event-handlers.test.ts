import { describe, expect, it } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import {
  initSceneHandlers,
  parseSceneCreated,
  parseSceneDeleted,
  parseSceneUpdated,
} from "./scene-event-handlers";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const SCENE_ID = "22222222-2222-2222-2222-222222222222";

function snakeCe(data: Record<string, unknown>) {
  return {
    application_id: APP_ID,
    client_id: "client-1",
    data,
  };
}

describe("parseSceneCreated", () => {
  it("decodes a snake_case row from buildSceneChangeData", () => {
    const ce = snakeCe({
      id: SCENE_ID,
      application_id: APP_ID,
      name: "Main",
      description: "Primary stream layout",
      widgets_json: '[{"id":"w1"}]',
      layout_json: '{"width":1920,"height":1080}',
      created_by_type: "USER",
      created_by_ref: "",
    });
    const { applicationId, clientId, event } = parseSceneCreated(ce);
    expect(applicationId).toBe(APP_ID);
    expect(clientId).toBe("client-1");
    expect(event?.type).toBe(EngineEventType.SCENE_CREATED);
    expect(event?.scene.id).toBe(SCENE_ID);
    expect(event?.scene.name).toBe("Main");
    expect(event?.scene.widgetsJson).toBe('[{"id":"w1"}]');
    expect(event?.scene.layoutJson).toBe('{"width":1920,"height":1080}');
    expect(event?.scene.createdByType).toBe("USER");
  });

  it("accepts capitalized Go-default field names too", () => {
    const ce = snakeCe({
      ID: SCENE_ID,
      Name: "Main",
      WidgetsJSON: "[]",
      LayoutJSON: "{}",
      CreatedByType: "MODULE",
      CreatedByRef: "counter:0.1.0:abc",
    });
    const { event } = parseSceneCreated(ce);
    expect(event?.scene.id).toBe(SCENE_ID);
    expect(event?.scene.name).toBe("Main");
    expect(event?.scene.createdByType).toBe("MODULE");
    expect(event?.scene.createdByRef).toBe("counter:0.1.0:abc");
  });

  it("returns null event when id is missing", () => {
    const ce = snakeCe({ name: "Main" });
    const { event } = parseSceneCreated(ce);
    expect(event).toBeNull();
  });

  it("defaults missing widgets_json / layout_json to '[]' / '{}'", () => {
    const ce = snakeCe({ id: SCENE_ID, name: "Main" });
    const { event } = parseSceneCreated(ce);
    expect(event?.scene.widgetsJson).toBe("[]");
    expect(event?.scene.layoutJson).toBe("{}");
  });
});

describe("parseSceneUpdated", () => {
  it("produces a SCENE_UPDATED event with snapshot fields", () => {
    const ce = snakeCe({
      id: SCENE_ID,
      name: "Main v2",
      widgets_json: "[]",
      layout_json: "{}",
    });
    const { event } = parseSceneUpdated(ce);
    expect(event?.type).toBe(EngineEventType.SCENE_UPDATED);
    expect(event?.scene.name).toBe("Main v2");
  });
});

describe("parseSceneDeleted", () => {
  it("returns SCENE_DELETED with the scene id", () => {
    const ce = snakeCe({ id: SCENE_ID });
    const { event } = parseSceneDeleted(ce);
    expect(event?.type).toBe(EngineEventType.SCENE_DELETED);
    expect(event?.sceneId).toBe(SCENE_ID);
  });

  it("falls back to entity_id when data is missing the row", () => {
    const ce = {
      application_id: APP_ID,
      client_id: "c",
      entity_id: SCENE_ID,
    };
    const { event } = parseSceneDeleted(ce);
    expect(event?.sceneId).toBe(SCENE_ID);
  });

  it("returns null when neither data.id nor entity_id is present", () => {
    const ce = { application_id: APP_ID, client_id: "c" };
    const { event } = parseSceneDeleted(ce);
    expect(event).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initSceneHandlers — end-to-end subscribe -> parse -> webhook wiring,
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

describe("initSceneHandlers", () => {
  it("db.scene.created.* dispatches a scene.created webhook", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initSceneHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.scene.created.app-1", {
      data: { ID: SCENE_ID, ApplicationID: APP_ID, Name: "Main Scene" },
    });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe(EngineEventType.SCENE_CREATED);
  });

  it("db.scene.deleted.* dispatches a scene.deleted webhook", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initSceneHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.scene.deleted.app-1", { data: { id: SCENE_ID } });

    expect(webhook.sentEvents).toHaveLength(1);
    expect(webhook.sentEvents[0]?.type).toBe(EngineEventType.SCENE_DELETED);
  });

  it("skips the webhook when the payload is missing a scene id", async () => {
    const nats = new FakeNatsClient();
    const webhook = new FakeWebhookClient();
    await initSceneHandlers(nats as any, webhook as any, noopLogger);

    await nats.dispatch("db.scene.created.app-1", { data: {} });

    expect(webhook.sentEvents).toHaveLength(0);
  });
});
