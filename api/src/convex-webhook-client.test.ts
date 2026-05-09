import { describe, expect, it, mock } from "bun:test";
import { createHmac } from "node:crypto";
import { ConvexWebhookClient } from "./convex-webhook-client";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function fakeDb({
  url = "https://convex.test/hook",
  secret = "shh",
}: { url?: string | null; secret?: string | null } = {}): any {
  return {
    getSetting: mock(async (key: string) => {
      if (key === "convex.webhook_url") return url;
      if (key === "convex.signing_secret") return secret;
      return null;
    }),
  };
}

describe("ConvexWebhookClient", () => {
  it("posts a signed envelope with payload + alert kind on success", async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    const fetchFn = mock(async (url: string, init: RequestInit) => {
      captured.push({ url, init });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
    });

    await client.sendAlert("ch-1", { type: "follow", user: "alice" });

    expect(captured).toHaveLength(1);
    const sent = captured[0];
    expect(sent.url).toBe("https://convex.test/hook");
    expect((sent.init.headers as any)["Content-Type"]).toBe("application/json");

    const body = sent.init.body as string;
    const headerSig = (sent.init.headers as any)["X-Woofx3-Signature"] as string;
    const expected = "sha256=" + createHmac("sha256", "shh").update(body).digest("hex");
    expect(headerSig).toBe(expected);

    const envelope = JSON.parse(body);
    expect(envelope.kind).toBe("alert");
    expect(envelope.channelId).toBe("ch-1");
    expect(envelope.payload).toEqual({ type: "follow", user: "alice" });
    expect(typeof envelope.eventId).toBe("string");
    expect(envelope.eventId.length).toBeGreaterThan(0);
    expect(typeof envelope.emittedAt).toBe("number");
  });

  it("does not retry on 4xx terminal failures", async () => {
    let calls = 0;
    const fetchFn = mock(async () => {
      calls += 1;
      return new Response("bad", { status: 401 });
    }) as unknown as typeof fetch;

    const scheduled: Array<() => void> = [];
    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
      scheduleRetry: (fn) => {
        scheduled.push(fn);
      },
    });

    await client.sendAlert("ch-1", { type: "follow", user: "alice" });
    expect(calls).toBe(1);
    expect(scheduled).toHaveLength(0);
    expect(client.inFlightCount()).toBe(0);
  });

  it("retries on 5xx with the spec'd backoff schedule", async () => {
    let calls = 0;
    const fetchFn = mock(async () => {
      calls += 1;
      return new Response("oops", { status: 503 });
    }) as unknown as typeof fetch;

    const delays: number[] = [];
    const fns: Array<() => void> = [];
    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
      scheduleRetry: (fn, ms) => {
        delays.push(ms);
        fns.push(fn);
      },
    });

    await client.sendAlert("ch-1", { type: "follow", user: "alice" });
    expect(calls).toBe(1);
    expect(delays[0]).toBe(1_000);

    await fns[0]();
    expect(calls).toBe(2);
    expect(delays[1]).toBe(5_000);

    await fns[1]();
    expect(calls).toBe(3);
    expect(delays[2]).toBe(30_000);

    await fns[2]();
    expect(calls).toBe(4);
    expect(delays[3]).toBe(5 * 60_000);

    await fns[3]();
    expect(calls).toBe(5);
    expect(delays[4]).toBe(30 * 60_000);

    // After the 5th attempt also fails, no further retries are scheduled.
    await fns[4]();
    expect(calls).toBe(6);
    expect(delays).toHaveLength(5);
    expect(client.inFlightCount()).toBe(0);
  });

  it("reuses the same eventId across retries (idempotency)", async () => {
    const seen: string[] = [];
    const fetchFn = mock(async (_url: string, init: RequestInit) => {
      const env = JSON.parse(init.body as string);
      seen.push(env.eventId);
      return new Response("oops", { status: 503 });
    }) as unknown as typeof fetch;

    const fns: Array<() => void> = [];
    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
      scheduleRetry: (fn) => {
        fns.push(fn);
      },
    });

    await client.sendAlert("ch-1", { type: "follow", user: "alice" });
    await fns[0]();
    await fns[1]();
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
  });

  it("drops duplicates by eventId via sendEnvelope", async () => {
    let calls = 0;
    const fetchFn = mock(async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
    });
    const envelope = {
      eventId: "fixed-id-1",
      channelId: "ch-1",
      emittedAt: 1,
      kind: "alert" as const,
      payload: { type: "follow" as const, user: "alice" },
    };
    await client.sendEnvelope(envelope);
    await client.sendEnvelope(envelope);
    expect(calls).toBe(1);
  });

  it("is a no-op when no Convex webhook config is set", async () => {
    const fetchFn = mock(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const client = new ConvexWebhookClient({
      db: fakeDb({ url: null, secret: null }),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
    });
    await client.sendAlert("ch-1", { type: "follow", user: "alice" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("drops items that exceed TTL before next attempt", async () => {
    let calls = 0;
    const fetchFn = mock(async () => {
      calls += 1;
      return new Response("oops", { status: 503 });
    }) as unknown as typeof fetch;

    const fns: Array<() => void> = [];
    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
      scheduleRetry: (fn) => {
        fns.push(fn);
      },
      ttlMs: 1, // Effectively expires immediately for the retry path.
    });

    await client.sendAlert("ch-1", { type: "follow", user: "alice" });
    expect(calls).toBe(1);

    // Force time past the TTL before retry runs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fns[0]();

    // The retry sees expiry and gives up without a new fetch.
    expect(calls).toBe(1);
    expect(client.inFlightCount()).toBe(0);
  });

  it("retries on network errors (fetch rejection)", async () => {
    let calls = 0;
    const fetchFn = mock(async () => {
      calls += 1;
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const fns: Array<() => void> = [];
    const client = new ConvexWebhookClient({
      db: fakeDb(),
      logger: fakeLogger(),
      applicationId: "app-1",
      fetchFn,
      scheduleRetry: (fn) => {
        fns.push(fn);
      },
    });

    await client.sendAlert("ch-1", { type: "follow", user: "alice" });
    expect(calls).toBe(1);
    expect(fns).toHaveLength(1);
  });
});
