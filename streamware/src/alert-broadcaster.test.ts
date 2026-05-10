import { describe, expect, it, mock } from "bun:test";
import { AlertBroadcaster } from "./alert-broadcaster";

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
  const client: any = {
    published,
    publish: mock((subject: string, data: Uint8Array) => {
      published.push({ subject, payload: JSON.parse(new TextDecoder().decode(data)) });
      return Promise.resolve();
    }),
  };
  return client;
}

interface FakeWs {
  data: { kind: "alerts"; id: string };
  sent: string[];
  send: (data: string) => void;
}

function fakeWs(id: string): FakeWs {
  const ws: FakeWs = {
    data: { kind: "alerts", id },
    sent: [],
    send(data: string) {
      this.sent.push(data);
    },
  };
  return ws;
}

describe("AlertBroadcaster overlay inbound", () => {
  it("forwards a widget.event with key=alert.lifecycle to NATS widget.event", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const bc = new AlertBroadcaster(logger, nats);
    const handlers = bc.handlers();
    const ws = fakeWs("overlay-1");
    handlers.open?.(ws as any);
    handlers.message?.(
      ws as any,
      JSON.stringify({
        kind: "widget.event",
        moduleId: "core",
        instanceId: "alert-overlay",
        key: "alert.lifecycle",
        value: { envelopeId: "env-1", state: "playing" },
      })
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

  it("forwards alert.lifecycle with error", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const bc = new AlertBroadcaster(logger, nats);
    const handlers = bc.handlers();
    const ws = fakeWs("overlay-1");
    handlers.open?.(ws as any);
    handlers.message?.(
      ws as any,
      JSON.stringify({
        kind: "widget.event",
        moduleId: "core",
        instanceId: "alert-overlay",
        key: "alert.lifecycle",
        value: { envelopeId: "env-2", state: "failed", error: "autoplay blocked" },
      })
    );
    expect(nats.published).toHaveLength(1);
    expect((nats.published[0]!.payload as any).data.value.error).toBe("autoplay blocked");
  });

  it("drops malformed JSON without throwing", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const bc = new AlertBroadcaster(logger, nats);
    const handlers = bc.handlers();
    const ws = fakeWs("overlay-1");
    handlers.open?.(ws as any);
    handlers.message?.(ws as any, "this is not json");
    expect(nats.published).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drops messages with unknown kind", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const bc = new AlertBroadcaster(logger, nats);
    const handlers = bc.handlers();
    const ws = fakeWs("overlay-1");
    handlers.open?.(ws as any);
    handlers.message?.(ws as any, JSON.stringify({ kind: "garbage" }));
    expect(nats.published).toHaveLength(0);
  });

  it("drops widget.event with missing moduleId / instanceId / key", () => {
    const logger = fakeLogger();
    const nats = fakeNats();
    const bc = new AlertBroadcaster(logger, nats);
    const handlers = bc.handlers();
    const ws = fakeWs("overlay-1");
    handlers.open?.(ws as any);
    handlers.message?.(ws as any, JSON.stringify({ kind: "widget.event", moduleId: "core" }));
    expect(nats.published).toHaveLength(0);
  });

  it("does not throw when NATS is unavailable; logs and drops", () => {
    const logger = fakeLogger();
    const bc = new AlertBroadcaster(logger, null);
    const handlers = bc.handlers();
    const ws = fakeWs("overlay-1");
    handlers.open?.(ws as any);
    handlers.message?.(
      ws as any,
      JSON.stringify({
        kind: "widget.event",
        moduleId: "core",
        instanceId: "alert-overlay",
        key: "alert.lifecycle",
        value: { envelopeId: "env-4", state: "playing" },
      })
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("broadcast() pushes the envelope to every connected client", () => {
    const logger = fakeLogger();
    const bc = new AlertBroadcaster(logger, null);
    const handlers = bc.handlers();
    const a = fakeWs("a");
    const b = fakeWs("b");
    handlers.open?.(a as any);
    handlers.open?.(b as any);
    bc.broadcast({ id: "env-x", parameters: { widget: "MediaWidget" }, event: null });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]!).id).toBe("env-x");
  });
});
