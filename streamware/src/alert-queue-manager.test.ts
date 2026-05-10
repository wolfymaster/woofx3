import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { AlertQueueManager, type AlertEnvelope } from "./alert-queue-manager";

const APP = "11111111-1111-1111-1111-111111111111";

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
    publish: mock(async (subject: string, data: Uint8Array) => {
      published.push({ subject, payload: JSON.parse(new TextDecoder().decode(data)) });
    }),
  };
  return client;
}

function fakeDb() {
  const calls: Array<{ kind: string; args: any }> = [];
  const db: any = {
    calls,
    updateAlertLifecycle: mock(async (req: any) => {
      calls.push({ kind: "updateAlertLifecycle", args: req });
      return { status: { code: "OK", message: "" }, alert: { id: req.envelopeId, ...req } };
    }),
  };
  return db;
}

function envelope(id: string, opts: { duration?: number; appId?: string } = {}): AlertEnvelope {
  const applicationId = opts.appId ?? APP;
  const params: Record<string, unknown> = { widget: "MediaWidget" };
  if (opts.duration !== undefined) {
    params.duration = opts.duration;
  }
  return {
    id,
    applicationId,
    parameters: params as AlertEnvelope["parameters"],
    event: null,
    rawJson: JSON.stringify({ id, parameters: params, event: null, applicationId }),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AlertQueueManager", () => {
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;

  beforeEach(() => {
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
  });
  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  it("dispatches the first enqueued alert immediately", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("env-1", { duration: 5 }));

    expect(nats.published).toHaveLength(1);
    expect(nats.published[0]!.subject).toBe("ui.alert.broadcast");
    expect((nats.published[0]!.payload as any).id).toBe("env-1");
    // dispatched_at gets stamped via the db RPC
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!).toEqual({
      kind: "updateAlertLifecycle",
      args: { applicationId: APP, envelopeId: "env-1", status: "dispatched", error: "" },
    });
    expect(qm.inFlight(APP)?.id).toBe("env-1");
    expect(qm.pendingCount(APP)).toBe(0);
  });

  it("queues additional alerts behind the in-flight lease", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("env-1", { duration: 5 }));
    await qm.enqueue(envelope("env-2", { duration: 5 }));
    await qm.enqueue(envelope("env-3", { duration: 5 }));

    // Only env-1 was dispatched.
    expect(nats.published).toHaveLength(1);
    expect((nats.published[0]!.payload as any).id).toBe("env-1");
    expect(qm.inFlight(APP)?.id).toBe("env-1");
    expect(qm.pendingCount(APP)).toBe(2);
  });

  it("dispatches the next alert when the in-flight one completes", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("env-1", { duration: 5 }));
    await qm.enqueue(envelope("env-2", { duration: 5 }));

    await qm.handleStatus(APP, "env-1", "playing");
    await qm.handleStatus(APP, "env-1", "completed");

    expect(nats.published).toHaveLength(2);
    expect((nats.published[1]!.payload as any).id).toBe("env-2");
    expect(qm.inFlight(APP)?.id).toBe("env-2");
    expect(qm.pendingCount(APP)).toBe(0);

    // db.updateAlertLifecycle calls in order: dispatched(1), playing, completed, dispatched(2)
    const statuses = db.calls.map((c: any) => c.args.status);
    expect(statuses).toEqual(["dispatched", "playing", "completed", "dispatched"]);
  });

  it("times out a stuck alert and dispatches the next one", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger(), {
      leaseBufferSeconds: 0,
      maxLeaseSeconds: 5,
    });

    // env-1 has a tiny lease so it expires quickly; env-2 has a
    // large lease so it survives long enough for the assertion.
    await qm.enqueue(envelope("env-1", { duration: 0.1 }));
    await qm.enqueue(envelope("env-2", { duration: 5 }));
    expect(qm.inFlight(APP)?.id).toBe("env-1");

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flush();

    expect(qm.inFlight(APP)?.id).toBe("env-2");
    const lifecycleCalls = db.calls.filter((c: any) => c.kind === "updateAlertLifecycle");
    const statuses = lifecycleCalls.map((c: any) => c.args.status);
    expect(statuses).toContain("timed_out");
    expect(statuses[statuses.length - 1]).toBe("dispatched"); // env-2 dispatched after timeout
  });

  it("ignores stale acks for an envelope that's no longer in flight", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("env-1", { duration: 5 }));
    await qm.handleStatus(APP, "env-1", "completed");
    // env-1 is gone now. A late ack arrives:
    await qm.handleStatus(APP, "env-1", "completed");
    // No second db lifecycle call for the stale ack.
    const completedCalls = db.calls.filter(
      (c: any) => c.kind === "updateAlertLifecycle" && c.args.envelopeId === "env-1" && c.args.status === "completed"
    );
    expect(completedCalls).toHaveLength(1);
  });

  it("skipCurrent advances the queue and marks the row skipped", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("env-1"));
    await qm.enqueue(envelope("env-2"));
    expect(qm.inFlight(APP)?.id).toBe("env-1");

    const ok = await qm.skipCurrent(APP);
    expect(ok).toBe(true);
    expect(qm.inFlight(APP)?.id).toBe("env-2");
    const skipCalls = db.calls.filter((c: any) => c.args.status === "skipped");
    expect(skipCalls).toHaveLength(1);
    expect(skipCalls[0]!.args.envelopeId).toBe("env-1");
  });

  it("clearPending marks every pending alert skipped without touching the lease", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("env-1"));
    await qm.enqueue(envelope("env-2"));
    await qm.enqueue(envelope("env-3"));
    expect(qm.pendingCount(APP)).toBe(2);

    const cleared = await qm.clearPending(APP);
    expect(cleared).toBe(2);
    expect(qm.pendingCount(APP)).toBe(0);
    expect(qm.inFlight(APP)?.id).toBe("env-1");
  });

  it("isolates queues by applicationId", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const qm = new AlertQueueManager(db, nats, fakeLogger());

    await qm.enqueue(envelope("a1", { appId: "app-A" }));
    await qm.enqueue(envelope("b1", { appId: "app-B" }));

    // Both should dispatch immediately since each app has no in-flight.
    expect(nats.published).toHaveLength(2);
    expect(qm.inFlight("app-A")?.id).toBe("a1");
    expect(qm.inFlight("app-B")?.id).toBe("b1");
  });

  it("drops envelopes without applicationId or envelope id", async () => {
    const nats = fakeNats();
    const db = fakeDb();
    const log = fakeLogger();
    const qm = new AlertQueueManager(db, nats, log);

    await qm.enqueue({ ...envelope("env-1"), applicationId: "" });
    await qm.enqueue({ ...envelope(""), applicationId: APP });
    expect(nats.published).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});
