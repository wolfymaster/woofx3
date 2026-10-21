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
    // Must stay below the scene manager's 30 s replay dedupe window.
    expect(requests[0]!.timeout).toBeLessThan(30_000);
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

/** An alert row as db-proxy returns it, created and dispatched at noon on 2026-10-20. */
function storedAlert(id: string, overrides: Record<string, unknown> = {}) {
  const unset = { seconds: 0n, nanos: 0 };
  const noon = { seconds: 1_792_497_600n, nanos: 0 };
  return {
    id,
    payload: `{"id":"env-${id}"}`,
    workflowId: "",
    sourceEventId: "",
    status: "completed",
    createdAt: noon,
    updatedAt: noon,
    envelopeId: `env-${id}`,
    dispatchedAt: noon,
    playedAt: unset,
    completedAt: unset,
    error: "",
    version: 2n,
    ...overrides,
  };
}

/** listAlerts touches only `db.listAlerts`; every request it makes is recorded. */
function listAlerts(query: unknown, rows = [storedAlert("a"), storedAlert("b")], totalCount = 7) {
  const requests: unknown[] = [];
  const ctx = {
    logger: fakeLogger(),
    db: {
      async listAlerts(req: unknown) {
        requests.push(req);
        return { alerts: rows, totalCount };
      },
    },
  };
  const route = alertsRoutes.listAlerts as unknown as (q: unknown) => Promise<Record<string, unknown>>;
  return { requests, result: route.call(ctx, query) };
}

describe("listAlerts", () => {
  test("pages newest first with the defaults, as the alert callbacks' snapshots", async () => {
    const { requests, result } = listAlerts(undefined);
    const page = await result;

    expect(requests).toEqual([{ limit: 50, offset: 0, workflowId: "" }]);
    expect(page).toMatchObject({ totalCount: 7, limit: 50, offset: 0 });
    expect(page.alerts).toEqual([
      {
        id: "a",
        payload: '{"id":"env-a"}',
        workflowId: "",
        sourceEventId: "",
        status: "completed",
        version: 2,
        envelopeId: "env-a",
        dispatchedAt: "2026-10-20T12:00:00.000000000Z",
        createdAt: "2026-10-20T12:00:00.000000000Z",
        updatedAt: "2026-10-20T12:00:00.000000000Z",
      },
      expect.objectContaining({ id: "b" }),
    ]);
  });

  test("asks for one run's alerts and the page it was given", async () => {
    const { requests, result } = listAlerts({ limit: 500, offset: 20, workflowId: "run-1" });
    await result;

    expect(requests).toEqual([{ limit: 500, offset: 20, workflowId: "run-1" }]);
  });

  const refused: Array<[string, unknown, string]> = [
    ["a limit of 0", { limit: 0 }, "limit must be a whole number from 1 to 500"],
    ["a limit over the most", { limit: 501 }, "limit must be a whole number from 1 to 500"],
    ["a fractional limit", { limit: 1.5 }, "limit must be a whole number from 1 to 500"],
    ["a negative offset", { offset: -1 }, "offset must be a whole number of 0 or more"],
    ["a fractional offset", { offset: 0.5 }, "offset must be a whole number of 0 or more"],
  ];
  for (const [name, query, message] of refused) {
    test(`refuses ${name} without asking db-proxy`, async () => {
      const { requests, result } = listAlerts(query);

      await expect(result).rejects.toThrow(message);
      expect(requests).toEqual([]);
    });
  }

  test("fails when db-proxy sends a row without its creation time", async () => {
    const { result } = listAlerts({}, [storedAlert("a", { createdAt: { seconds: 0n, nanos: 0 } })]);

    await expect(result).rejects.toThrow("stored row a has no createdAt");
  });
});

describe("getAlertQueue", () => {
  const playing = [{ alertId: "row-a", envelopeId: "env-a", startedAt: "2026-10-20T12:00:00.000Z" }];
  const waiting = [{ alertId: "", envelopeId: "env-b" }];

  const answers: Array<{ name: string; answer: unknown; expected: unknown }> = [
    {
      name: "returns the scene manager's queue",
      answer: { ok: true, playing, waiting },
      expected: { ok: true, playing, waiting },
    },
    {
      name: "carries a refusal through with its reason",
      answer: { ok: false, playing: [], waiting: [], reason: "no overlay is open" },
      expected: { ok: false, playing: [], waiting: [], reason: "no overlay is open" },
    },
    {
      name: "gives empty lists to a request the scene manager failed to handle",
      answer: { ok: false, reason: "store unavailable" },
      expected: { ok: false, playing: [], waiting: [], reason: "store unavailable" },
    },
  ];
  for (const { name, answer, expected } of answers) {
    test(name, async () => {
      const { nats, requests } = answeringNats(() => answer);

      expect(await call(nats, "getAlertQueue")).toEqual(expected);
      expect(requests.map((r) => [r.subject, r.body])).toEqual([["widget.queue.state", {}]]);
    });
  }

  const unreadable: Array<[string, unknown]> = [
    ["no lists", { ok: true }],
    ["an entry without an envelope id", { ok: true, playing: [{ alertId: "row-a" }], waiting: [] }],
    ["a start that is not text", { ok: true, playing: [{ alertId: "", envelopeId: "e", startedAt: 5 }], waiting: [] }],
  ];
  for (const [name, answer] of unreadable) {
    test(`fails on an answer with ${name}`, async () => {
      const { nats } = answeringNats(() => answer);

      await expect(call(nats, "getAlertQueue")).rejects.toThrow("unreadable queue");
    });
  }

  test("reports a scene manager that does not answer as a refusal", async () => {
    const nats = {
      async request() {
        throw new Error("503");
      },
    };

    expect(await call(nats, "getAlertQueue")).toEqual({
      ok: false,
      playing: [],
      waiting: [],
      reason: "the scene manager did not answer: 503",
    });
  });
});
