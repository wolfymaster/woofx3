import { describe, expect, test } from "bun:test";
import { HOST_REQUEST_SOURCE, HostRequests, parsed, parseFailed, type RawRequestSpec } from "./host-requests";
import { ScopeCounters, ScopedBus } from "./scoped-bus";
import { bytes, countingIds, FakeBus, FakeTime, flush, RecordingLogger, text } from "./testing";

type Echo = { say: string };

function parseEcho(raw: Uint8Array) {
  const value: unknown = JSON.parse(text(raw));
  if (typeof value === "object" && value !== null && "say" in value && typeof value.say === "string") {
    return parsed<Echo>({ say: value.say });
  }
  return parseFailed<Echo>("say must be a string");
}

function setup() {
  const time = new FakeTime();
  const client = new FakeBus();
  const logger = new RecordingLogger();
  const requests = new HostRequests({ clock: time, ids: countingIds(), timers: time, logger });
  const scope = new ScopedBus({
    scope: "host",
    client,
    grants: { publishes: [], subscribes: ["echo.raw", "echo.ce"], requests: [] },
    limits: { concurrency: 4, queueCap: 4 },
    logger,
    counters: new ScopeCounters(),
    clock: time,
  });
  return { time, client, logger, requests, scope };
}

const rawSpec = (handle: RawRequestSpec<Echo>["handle"]): RawRequestSpec<Echo> => ({
  subject: "echo.raw",
  budgetMs: 1_000,
  replyMode: "raw",
  parse: parseEcho,
  handle,
  errorReply: (code, message) => bytes(`${code}:${message}`),
});

describe("HostRequests", () => {
  test("raw mode writes the handler's bytes as they are", async () => {
    const { client, requests, scope } = setup();
    await requests.serveRequest(
      scope,
      rawSpec(async (req) => bytes(`heard ${req.say}`))
    );

    const replies = client.deliver("echo.raw", bytes('{"say":"hi"}'), "inbox.1");
    await flush();
    expect(replies.map(text)).toEqual(["heard hi"]);
    expect(requests.snapshot()["echo.raw"]).toEqual({
      received: 1,
      replied: 1,
      invalid: 0,
      internal: 0,
      expired: 0,
      noInbox: 0,
    });
  });

  test("cloudevent mode wraps the reply with an id, type, source and time from the injected sources", async () => {
    const { client, requests, scope, time } = setup();
    await requests.serveRequest<Echo, { heard: string }>(scope, {
      subject: "echo.ce",
      budgetMs: 1_000,
      replyMode: "cloudevent",
      replyType: "echo.ce.result",
      parse: parseEcho,
      handle: async (req) => ({ heard: req.say }),
      errorReply: (code, message) => ({ heard: `${code}:${message}` }),
    });

    const replies = client.deliver("echo.ce", bytes('{"say":"hi"}'), "inbox.1");
    await flush();
    expect(JSON.parse(text(replies[0]))).toEqual({
      id: "id-1",
      type: "echo.ce.result",
      source: HOST_REQUEST_SOURCE,
      time: new Date(time.now()).toISOString(),
      data: { heard: "hi" },
    });
  });

  test("a request without a reply inbox is counted and never handled", async () => {
    const { client, requests, scope, logger } = setup();
    let handled = 0;
    await requests.serveRequest(
      scope,
      rawSpec(async () => {
        handled++;
        return bytes("x");
      })
    );

    client.deliver("echo.raw", bytes('{"say":"hi"}'));
    await flush();
    expect(handled).toBe(0);
    expect(requests.snapshot()["echo.raw"]).toMatchObject({ received: 1, replied: 0, noInbox: 1 });
    expect(logger.at("warn")).toHaveLength(1);
  });

  test("a request that fails to parse gets the invalid error reply", async () => {
    const { client, requests, scope } = setup();
    await requests.serveRequest(
      scope,
      rawSpec(async () => bytes("never"))
    );

    const replies = client.deliver("echo.raw", bytes('{"say":3}'), "inbox.1");
    await flush();
    expect(replies.map(text)).toEqual(["invalid:say must be a string"]);
    expect(requests.snapshot()["echo.raw"]).toMatchObject({ invalid: 1, replied: 1 });
  });

  test("a parser that throws gets the internal error reply", async () => {
    const { client, requests, scope } = setup();
    await requests.serveRequest(
      scope,
      rawSpec(async () => bytes("never"))
    );

    const replies = client.deliver("echo.raw", bytes("not json"), "inbox.1");
    await flush();
    expect(text(replies[0])).toStartWith("internal:");
    expect(requests.snapshot()["echo.raw"]).toMatchObject({ internal: 1, replied: 1 });
  });

  test("a handler that throws gets the internal error reply and is logged", async () => {
    const { client, requests, scope, logger } = setup();
    await requests.serveRequest(
      scope,
      rawSpec(async () => {
        throw new Error("upstream fell over");
      })
    );

    const replies = client.deliver("echo.raw", bytes('{"say":"hi"}'), "inbox.1");
    await flush();
    expect(replies.map(text)).toEqual(["internal:upstream fell over"]);
    expect(requests.snapshot()["echo.raw"]).toMatchObject({ internal: 1, replied: 1 });
    expect(logger.at("error")[0].metadata).toMatchObject({ subject: "echo.raw" });
  });

  test("the handler's signal aborts at arrival plus the budget", async () => {
    const { client, requests, scope, time } = setup();
    let seen: { deadline: number; arrivedAt: number } | undefined;
    await requests.serveRequest(
      scope,
      rawSpec(
        (_req, ctx) =>
          new Promise<Uint8Array>((resolve) => {
            seen = { deadline: ctx.deadline, arrivedAt: ctx.arrivedAt };
            ctx.signal.addEventListener("abort", () => resolve(bytes("gave up")));
          })
      )
    );

    const replies = client.deliver("echo.raw", bytes('{"say":"hi"}'), "inbox.1");
    await flush();
    expect(seen?.deadline).toBe((seen?.arrivedAt ?? 0) + 1_000);
    await time.advance(999);
    expect(replies).toHaveLength(0);
    await time.advance(1);
    expect(replies.map(text)).toEqual(["gave up"]);
  });

  const holdUntilAbort = rawSpec(
    (req, ctx) =>
      new Promise<Uint8Array>((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve(bytes(`gave up ${req.say}`)));
      })
  );

  test("a request queued behind busy handlers keeps the deadline of its arrival", async () => {
    const { client, requests, scope, time } = setup();
    await requests.serveRequest(scope, holdUntilAbort);

    // Four held requests take every handler slot (concurrency 4); the fifth queues 500 ms later.
    for (let i = 0; i < 4; i++) {
      client.deliver("echo.raw", bytes(`{"say":"held${i}"}`), `inbox.${i}`);
    }
    await flush();
    await time.advance(500);
    const queued = client.deliver("echo.raw", bytes('{"say":"queued"}'), "inbox.queued");
    await flush();

    await time.advance(500);
    expect(queued).toHaveLength(0);
    await time.advance(499);
    expect(queued).toHaveLength(0);
    await time.advance(1);
    expect(queued.map(text)).toEqual(["gave up queued"]);
  });

  test("a request whose budget ran out in the queue gets the expired error reply without being handled", async () => {
    const { client, requests, scope, time, logger } = setup();
    await requests.serveRequest(scope, holdUntilAbort);

    for (let i = 0; i < 4; i++) {
      client.deliver("echo.raw", bytes(`{"say":"held${i}"}`), `inbox.${i}`);
    }
    const queued = client.deliver("echo.raw", bytes('{"say":"queued"}'), "inbox.queued");
    await flush();
    await time.advance(1_000);

    expect(queued.map(text)).toEqual(["expired:waited past the 1000ms budget for a free handler"]);
    expect(requests.snapshot()["echo.raw"]).toMatchObject({ received: 5, replied: 5, expired: 1 });
    expect(logger.at("warn").some((entry) => entry.message.includes("past its budget"))).toBe(true);
  });

  test("serving a subject twice, or with a budget that is not a positive integer, is refused", async () => {
    const { requests, scope } = setup();
    await requests.serveRequest(
      scope,
      rawSpec(async () => bytes("x"))
    );
    await expect(
      requests.serveRequest(
        scope,
        rawSpec(async () => bytes("x"))
      )
    ).rejects.toThrow("already served");
    await expect(
      requests.serveRequest(scope, { ...rawSpec(async () => bytes("x")), subject: "echo.ce", budgetMs: 0 })
    ).rejects.toThrow("budgetMs");
  });
});
