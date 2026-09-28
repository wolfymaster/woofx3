import { describe, expect, test } from "bun:test";
import { alertsRoutes } from "../src/routes/alerts";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

/** A bus that answers every request with `answer`, recording what was asked. */
function answeringNats(answer: (subject: string, body: unknown) => unknown) {
  const requests: Array<{ subject: string; body: unknown; timeout?: number }> = [];
  return {
    requests,
    nats: {
      async request(subject: string, data: Uint8Array, opts?: { timeout?: number }) {
        const body = JSON.parse(new TextDecoder().decode(data));
        requests.push({ subject, body, timeout: opts?.timeout });
        return { subject, data: new TextEncoder().encode(JSON.stringify(answer(subject, body))) };
      },
    },
  };
}

/** The routes are a mixin over the api's route host; `nats` and `logger` are all they touch. */
function call<K extends keyof typeof alertsRoutes>(nats: unknown, name: K, ...args: unknown[]) {
  const route = alertsRoutes[name] as unknown as (...a: unknown[]) => Promise<unknown>;
  return route.call({ nats, logger: fakeLogger() }, ...args);
}

describe("alert queue controls", () => {
  test("skipCurrentAlert asks the scene manager and returns its answer", async () => {
    const { nats, requests } = answeringNats(() => ({ ok: true, skipped: 1 }));

    expect(await call(nats, "skipCurrentAlert")).toEqual({ ok: true, skipped: 1 });
    expect(requests.map((r) => [r.subject, r.body])).toEqual([["widget.queue.skip", {}]]);
    expect(requests[0]!.timeout).toBeGreaterThan(0);
  });

  test("clearAlertQueue carries a refusal through with its reason", async () => {
    const { nats, requests } = answeringNats(() => ({ ok: false, cleared: 0, reason: "no overlay is open" }));

    expect(await call(nats, "clearAlertQueue")).toEqual({ ok: false, cleared: 0, reason: "no overlay is open" });
    expect(requests[0]!.subject).toBe("widget.queue.clear");
  });

  test("replayAlert sends the alert id and returns the replay's envelope id", async () => {
    const { nats, requests } = answeringNats(() => ({ ok: true, replayEnvelopeId: "env-2" }));

    expect(await call(nats, "replayAlert", "row-1")).toEqual({ ok: true, replayEnvelopeId: "env-2" });
    expect(requests.map((r) => [r.subject, r.body])).toEqual([["widget.queue.replay", { id: "row-1" }]]);
  });

  test("replayAlert rejects an empty id without asking", async () => {
    const { nats, requests } = answeringNats(() => ({ ok: true }));

    await expect(call(nats, "replayAlert", "")).rejects.toThrow("alert id is required");
    expect(requests).toEqual([]);
  });

  // With no scene manager running the bus answers "no responders"; the
  // operator needs that as a reason on a toast, not a failed request.
  test("reports a scene manager that does not answer as a refusal", async () => {
    const nats = {
      async request() {
        throw new Error("503");
      },
    };

    expect(await call(nats, "skipCurrentAlert")).toEqual({
      ok: false,
      skipped: 0,
      reason: "the scene manager did not answer: 503",
    });
    expect(await call(nats, "clearAlertQueue")).toMatchObject({ ok: false, cleared: 0 });
    expect(await call(nats, "replayAlert", "row-1")).toMatchObject({ ok: false });
  });

  test("throws when the api has no bus at all", async () => {
    await expect(call(null, "skipCurrentAlert")).rejects.toThrow("NATS client not available");
  });
});
