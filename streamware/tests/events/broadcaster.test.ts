import { describe, expect, it, mock } from "bun:test";
import { publishWidgetEvent } from "../../src/events/wire";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function fakeNats() {
  const published: Array<{ subject: string; payload: unknown }> = [];
  return {
    published,
    publish: mock((subject: string, data: Uint8Array) => {
      published.push({ subject, payload: JSON.parse(new TextDecoder().decode(data)) });
      return Promise.resolve();
    }),
  } as any;
}

function fakeWs(id: string) {
  return { data: { id } } as any;
}

describe("publishWidgetEvent", () => {
  it("forwards a valid widget.event to NATS", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    publishWidgetEvent(
      fakeWs("overlay-1"),
      JSON.stringify({
        kind: "widget.event",
        moduleId: "core",
        instanceId: "alert-overlay",
        key: "alert.lifecycle",
        value: { envelopeId: "env-1", state: "playing" },
      }),
      nats,
      logger,
    );
    expect(nats.published).toHaveLength(1);
    const env = nats.published[0]!;
    expect(env.subject).toBe("widget.event");
    expect((env.payload as any).type).toBe("widget.event");
    expect((env.payload as any).data.moduleId).toBe("core");
    expect((env.payload as any).data.instanceId).toBe("alert-overlay");
    expect((env.payload as any).data.key).toBe("alert.lifecycle");
    expect((env.payload as any).data.value).toEqual({ envelopeId: "env-1", state: "playing" });
  });

  it("uses applicationId as clientId when id is absent", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const ws = { data: { applicationId: "app-123" } } as any;
    publishWidgetEvent(
      ws,
      JSON.stringify({
        kind: "widget.event",
        moduleId: "m",
        instanceId: "i",
        key: "k",
        value: 1,
      }),
      nats,
      logger,
    );
    expect(nats.published).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ clientId: "app-123" }),
    );
  });

  it("drops malformed JSON without throwing", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    publishWidgetEvent(fakeWs("ws-1"), "this is not json", nats, logger);
    expect(nats.published).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drops messages with unknown kind", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    publishWidgetEvent(fakeWs("ws-1"), JSON.stringify({ kind: "garbage" }), nats, logger);
    expect(nats.published).toHaveLength(0);
  });

  it("drops widget.event with missing required fields", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    publishWidgetEvent(
      fakeWs("ws-1"),
      JSON.stringify({ kind: "widget.event", moduleId: "core" }),
      nats,
      logger,
    );
    expect(nats.published).toHaveLength(0);
  });

  it("logs and drops when NATS is unavailable", () => {
    const logger = fakeLogger();
    publishWidgetEvent(
      fakeWs("ws-1"),
      JSON.stringify({
        kind: "widget.event",
        moduleId: "core",
        instanceId: "alert-overlay",
        key: "alert.lifecycle",
        value: { envelopeId: "env-4", state: "playing" },
      }),
      null,
      logger,
    );
    expect(logger.warn).toHaveBeenCalled();
  });
});
