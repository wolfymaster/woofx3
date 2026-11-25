import { describe, expect, test } from "bun:test";
import { buildLogFilter, matchesLogFilter } from "../src/engine-logs/log-filter";
import { parseLogLine } from "../src/engine-logs/log-line";
import { record } from "./engine-logs-helpers";

describe("parseLogLine", () => {
  test("reads a record with its context fields", () => {
    const parsed = parseLogLine(
      record({ level: "WARN", requestId: "r1", traceId: "t1", metadata: { a: 1 }, extra: "ignored" })
    );
    expect(parsed).toEqual({
      timestamp: "2026-11-23T10:00:00.000Z",
      service: "api",
      level: "warn",
      message: "hello",
      metadata: { a: 1 },
      requestId: "r1",
      traceId: "t1",
    });
  });

  const rawCases: Array<{ name: string; line: string }> = [
    { name: "plain text", line: "panic: something broke" },
    { name: "a JSON array", line: "[1,2]" },
    { name: "a JSON string", line: '"x"' },
    { name: "a truncated record", line: '{"level":"info","mess' },
  ];
  for (const { name, line } of rawCases) {
    test(`${name} comes back as an unknown-level record holding the raw line`, () => {
      expect(parseLogLine(line)).toEqual({ timestamp: "", service: "", level: "unknown", message: line, metadata: {} });
    });
  }

  test("an unrecognised level is unknown, not dropped", () => {
    expect(parseLogLine(record({ level: "verbose" })).level).toBe("unknown");
  });

  test("metadata that is not an object becomes empty", () => {
    expect(parseLogLine(record({ metadata: "text" })).metadata).toEqual({});
  });
});

describe("log filter", () => {
  const line = record({ level: "error", message: "Disk FULL", metadata: { path: "/var" } });
  const parsed = parseLogLine(line);

  const cases: Array<{ name: string; query: Parameters<typeof buildLogFilter>[0]; want: boolean }> = [
    { name: "no filter", query: {}, want: true },
    { name: "matching level", query: { levels: ["error"] }, want: true },
    { name: "other level", query: { levels: ["info", "warn"] }, want: false },
    { name: "matching service", query: { services: ["api"] }, want: true },
    { name: "other service", query: { services: ["db"] }, want: false },
    { name: "text is case-insensitive", query: { text: "disk full" }, want: true },
    { name: "text searches metadata", query: { text: "/var" }, want: true },
    { name: "text miss", query: { text: "nope" }, want: false },
    { name: "from is inclusive", query: { from: "2026-11-23T10:00:00.000Z" }, want: true },
    { name: "before from", query: { from: "2026-11-23T10:00:00.001Z" }, want: false },
    { name: "to is exclusive", query: { to: "2026-11-23T10:00:00.000Z" }, want: false },
    { name: "inside the range", query: { from: "2026-11-23T09:00:00Z", to: "2026-11-23T11:00:00Z" }, want: true },
  ];
  for (const { name, query, want } of cases) {
    test(name, () => {
      expect(matchesLogFilter(buildLogFilter(query), parsed, line)).toBe(want);
    });
  }

  test("a record with no timestamp passes a time range", () => {
    const raw = "stack trace line";
    expect(matchesLogFilter(buildLogFilter({ from: "2026-11-23T00:00:00Z" }), parseLogLine(raw), raw)).toBe(true);
  });

  test("rejects a bad level or time", () => {
    expect(() => buildLogFilter({ levels: ["loud" as never] })).toThrow("unknown log level");
    expect(() => buildLogFilter({ from: "yesterday-ish" })).toThrow("from must be an ISO 8601 time");
  });
});
