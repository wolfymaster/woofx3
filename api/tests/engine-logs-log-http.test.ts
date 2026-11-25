import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SharedLogger } from "@woofx3/common/logging";
import { OPEN_REQUEST_GUARD_POLICY } from "@woofx3/common/http/request-guard";
import { strFromU8, unzipSync } from "fflate";
import { createHttpServer } from "../src/http";
import { abortableSleep } from "../src/engine-logs/abortable-sleep";
import { LogAccessTokens } from "../src/engine-logs/LogAccessTokens";
import { LogsHttp } from "../src/engine-logs/LogsHttp";
import { DEFAULT_LOG_STORE_CONFIG, LogStore } from "../src/engine-logs/LogStore";
import { appendLog, makeLogDir, record, writeLog } from "./engine-logs-helpers";

const silent = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as SharedLogger;

let dir: string;
let cleanup: () => Promise<void>;
let server: ReturnType<typeof createHttpServer> | null = null;
const clock = { ms: Date.parse("2026-11-23T12:00:00Z") };
const tokens = new LogAccessTokens(new Uint8Array(32).fill(3), () => clock.ms, { ttlMs: 60_000 });

beforeEach(async () => {
  ({ dir, cleanup } = await makeLogDir());
  await writeLog(
    dir,
    "api_20261123_0900.log",
    [record({ message: "a1" }), record({ message: "a2" })],
    new Date("2020-01-01T09:00:00Z")
  );
  await writeLog(dir, "api_traces_20261123_0900.log", ['{"name":"span"}'], new Date("2020-01-01T09:10:00Z"));
  const store = new LogStore({ ...DEFAULT_LOG_STORE_CONFIG, directory: dir });
  const logs = new LogsHttp({
    store,
    tokens,
    logger: silent,
    config: { pollMs: 5, heartbeatMs: 60_000 },
    now: () => new Date(clock.ms),
    sleep: abortableSleep,
  });
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({ ready: true }) as never,
    health: () => ({ status: "ok" }) as never,
    logger: silent,
    gateway: {} as never,
    requestGuard: OPEN_REQUEST_GUARD_POLICY,
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
    logs,
  });
});

afterEach(async () => {
  server?.stop(true);
  server = null;
  await cleanup();
});

const base = () => `http://127.0.0.1:${server?.port}`;

describe("GET /logs/export", () => {
  test("streams a zip of every log file, trace files included", async () => {
    const { token } = tokens.issue("export");
    const res = await fetch(`${base()}/logs/export?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="woofx3-logs-2026-11-23T12-00-00-000Z.zip"'
    );
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["api_20261123_0900.log", "api_traces_20261123_0900.log"]);
    expect(strFromU8(entries["api_20261123_0900.log"] as Uint8Array)).toContain("a2");
  });

  const refused: Array<{ name: string; query: string; status: number }> = [
    { name: "no token", query: "", status: 401 },
    { name: "a garbage token", query: "?token=abc", status: 401 },
  ];
  for (const { name, query, status } of refused) {
    test(`answers ${status} for ${name}`, async () => {
      const res = await fetch(`${base()}/logs/export${query}`);
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe("unauthorized");
    });
  }

  test("a stream token cannot download the export", async () => {
    const { token } = tokens.issue("stream");
    expect((await fetch(`${base()}/logs/export?token=${token}`)).status).toBe(401);
  });

  test("an expired token is refused", async () => {
    const { token } = tokens.issue("export");
    clock.ms += 61_000;
    try {
      expect((await fetch(`${base()}/logs/export?token=${token}`)).status).toBe(401);
    } finally {
      clock.ms -= 61_000;
    }
  });

  test("only GET is served, and unknown log routes are 404", async () => {
    const { token } = tokens.issue("export");
    expect((await fetch(`${base()}/logs/export?token=${token}`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base()}/logs/nope?token=${token}`)).status).toBe(404);
  });
});

async function readEvents(
  res: Response,
  count: number
): Promise<Array<{ id: string | null; data: Record<string, unknown> }>> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id: string | null; data: Record<string, unknown> }> = [];
  let buffer = "";
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value);
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      if (data !== undefined) {
        const id = block.split("\n").find((line) => line.startsWith("id: "));
        events.push({ id: id?.slice(4) ?? null, data: JSON.parse(data.slice(6)) });
      }
    }
  }
  await reader.cancel();
  return events;
}

describe("GET /logs/stream", () => {
  test("sends lines written after it connected, each with a resume id", async () => {
    const { token } = tokens.issue("stream");
    const res = await fetch(`${base()}/logs/stream?token=${token}`);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const pending = readEvents(res, 1);
    await appendLog(dir, "api_20261123_0900.log", [record({ message: "live" })]);
    const [event] = await pending;
    expect(event?.data.message).toBe("live");
    expect(event?.id?.startsWith("api_20261123_0900.log:")).toBe(true);
  });

  test("applies the level filter and resumes from Last-Event-ID", async () => {
    const { token } = tokens.issue("stream");
    const first = await fetch(`${base()}/logs/stream?token=${token}&levels=error`);
    const pending = readEvents(first, 1);
    await appendLog(dir, "api_20261123_0900.log", [
      record({ message: "quiet" }),
      record({ level: "error", message: "boom" }),
      record({ level: "error", message: "boom again" }),
    ]);
    const [boom] = await pending;
    expect(boom?.data.message).toBe("boom");

    const again = await fetch(`${base()}/logs/stream?token=${token}&levels=error`, {
      headers: { "Last-Event-ID": boom?.id as string },
    });
    const [next] = await readEvents(again, 1);
    expect(next?.data.message).toBe("boom again");
  });

  test("answers 400 for a bad filter instead of an empty stream", async () => {
    const { token } = tokens.issue("stream");
    const res = await fetch(`${base()}/logs/stream?token=${token}&levels=loud`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("unknown log level");
  });

  test("answers 401 without a stream token", async () => {
    expect((await fetch(`${base()}/logs/stream`)).status).toBe(401);
  });
});
