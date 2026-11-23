import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LOG_STORE_CONFIG, LogStore } from "../src/engine-logs/LogStore";
import { abortableSleep } from "../src/engine-logs/abortable-sleep";
import { appendLog, makeLogDir, record, writeLog } from "./engine-logs-helpers";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await makeLogDir());
});
afterEach(async () => {
  await cleanup();
});

function storeFor(overrides: Partial<typeof DEFAULT_LOG_STORE_CONFIG> = {}): LogStore {
  return new LogStore({ ...DEFAULT_LOG_STORE_CONFIG, ...overrides, directory: dir });
}

async function seed(): Promise<void> {
  await writeLog(
    dir,
    "api_20261123_0900.log",
    [1, 2, 3].map((n) => record({ message: `old ${n}`, timestamp: `2026-11-23T09:0${n}:00.000Z` })),
    new Date("2020-01-01T09:30:00Z")
  );
  await writeLog(
    dir,
    "db_20261123_1000.log",
    [
      record({ service: "db", message: "boot", timestamp: "2026-11-23T10:01:00.000Z" }),
      record({ service: "db", level: "error", message: "disk full", timestamp: "2026-11-23T10:02:00.000Z" }),
    ],
    new Date("2020-01-01T10:30:00Z")
  );
  await writeLog(dir, "api_traces_20261123_1000.log", ['{"name":"span"}'], new Date("2020-01-01T10:40:00Z"));
}

describe("LogStore.listFiles", () => {
  test("lists record files newest first and leaves out traces and other files", async () => {
    await seed();
    await writeFile(path.join(dir, "notes.txt"), "x");
    const files = await storeFor().listFiles();
    expect(files.map((file) => [file.name, file.service])).toEqual([
      ["db_20261123_1000.log", "db"],
      ["api_20261123_0900.log", "api"],
    ]);
  });

  test("a missing directory is an empty list, not an error", async () => {
    const store = new LogStore({ ...DEFAULT_LOG_STORE_CONFIG, directory: path.join(dir, "absent") });
    expect(await store.listFiles()).toEqual([]);
  });
});

describe("LogStore.query", () => {
  test("returns records newest first across files", async () => {
    await seed();
    const page = await storeFor().query({});
    expect(page.records.map((r) => r.message)).toEqual(["disk full", "boot", "old 3", "old 2", "old 1"]);
    expect(page.nextCursor).toBeNull();
  });

  test("pages with a cursor and never repeats or skips a record", async () => {
    await seed();
    const store = storeFor();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await store.query({ limit: 2, cursor });
      seen.push(...page.records.map((r) => r.message));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["disk full", "boot", "old 3", "old 2", "old 1"]);
  });

  test("filters by level, service and text", async () => {
    await seed();
    const store = storeFor();
    expect((await store.query({ levels: ["error"] })).records.map((r) => r.message)).toEqual(["disk full"]);
    expect((await store.query({ services: ["api"] })).records).toHaveLength(3);
    expect((await store.query({ text: "OLD 2" })).records.map((r) => r.message)).toEqual(["old 2"]);
  });

  test("filters by time", async () => {
    await seed();
    const page = await storeFor().query({ from: "2026-11-23T09:02:00Z", to: "2026-11-23T10:02:00Z" });
    expect(page.records.map((r) => r.message)).toEqual(["boot", "old 3", "old 2"]);
  });

  test("a line that is not JSON is kept and takes its file's service", async () => {
    await writeLog(dir, "api_20261123_0900.log", ["goroutine 1 [running]:"], new Date("2020-01-01T00:00:00Z"));
    const page = await storeFor().query({ services: ["api"] });
    expect(page.records[0]).toMatchObject({ level: "unknown", service: "api", message: "goroutine 1 [running]:" });
  });

  test("a scan budget returns what was found so far with a cursor", async () => {
    await seed();
    const store = storeFor({ scanBudgetBytes: 1 });
    const page = await store.query({ text: "no such text" });
    expect(page.records).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    const rest = await store.query({ text: "no such text", cursor: page.nextCursor as string });
    expect(rest.records).toEqual([]);
  });

  const bad: Array<{ name: string; query: Parameters<LogStore["query"]>[0]; message: string }> = [
    { name: "limit of zero", query: { limit: 0 }, message: "limit must be" },
    { name: "limit over the maximum", query: { limit: 501 }, message: "limit must be" },
    { name: "fractional limit", query: { limit: 1.5 }, message: "limit must be" },
    { name: "garbage cursor", query: { cursor: "nonsense" }, message: "cursor is not a log position" },
    { name: "cursor for a missing file", query: { cursor: "gone_20260101_0000.log:5" }, message: "no longer exists" },
    { name: "path traversal in a cursor", query: { cursor: "../../etc/passwd:0" }, message: "no longer exists" },
  ];
  for (const { name, query, message } of bad) {
    test(`rejects ${name}`, async () => {
      await seed();
      await expect(storeFor().query(query)).rejects.toThrow(message);
    });
  }
});

describe("LogStore.tail", () => {
  const sleeps = { pollMs: 5, sleep: abortableSleep };

  test("yields only lines written after it started, and each with a resume id", async () => {
    await seed();
    const abort = new AbortController();
    const tail = await storeFor().tail({}, { after: null, signal: abort.signal, ...sleeps });
    const first = tail.next();
    await appendLog(dir, "db_20261123_1000.log", [record({ message: "fresh" })]);
    const item = await first;
    expect(item.value?.record.message).toBe("fresh");
    expect(item.value?.resumeId.startsWith("db_20261123_1000.log:")).toBe(true);
    abort.abort();
  });

  test("resuming from a resume id replays what came after it, once", async () => {
    await seed();
    const abort = new AbortController();
    const store = storeFor();
    const live = await store.tail({}, { after: null, signal: abort.signal, ...sleeps });
    const pending = live.next();
    await appendLog(dir, "db_20261123_1000.log", [record({ message: "one" }), record({ message: "two" })]);
    const one = (await pending).value;
    expect(one?.record.message).toBe("one");
    abort.abort();

    const again = new AbortController();
    const resumed = await store.tail({}, { after: one?.resumeId ?? null, signal: again.signal, ...sleeps });
    const next = await resumed.next();
    expect(next.value?.record.message).toBe("two");
    again.abort();
  });

  test("rejects a bad filter or resume position before yielding anything", async () => {
    await seed();
    const signal = new AbortController().signal;
    await expect(storeFor().tail({ levels: ["loud" as never] }, { after: null, signal, ...sleeps })).rejects.toThrow(
      "unknown log level"
    );
    await expect(storeFor().tail({}, { after: "nonsense", signal, ...sleeps })).rejects.toThrow("not a log position");
    await expect(storeFor().tail({}, { after: "gone_20260101_0000.log:1", signal, ...sleeps })).rejects.toThrow(
      "no longer exists"
    );
  });
});
