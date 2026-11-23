import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readLinesBackward, readLinesForward } from "../src/engine-logs/read-lines";
import { makeLogDir } from "./engine-logs-helpers";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await makeLogDir());
});
afterEach(async () => {
  await cleanup();
});

async function collect(path: string, end: number) {
  const lines: Array<{ text: string; offset: number; end: number }> = [];
  for await (const line of readLinesBackward(path, end)) {
    lines.push(line);
  }
  return lines;
}

describe("readLinesBackward", () => {
  test("yields lines last first with offsets that locate them", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "one\ntwo\nthree\n");
    const lines = await collect(file, 14);
    expect(lines.map((line) => line.text)).toEqual(["three", "two", "one"]);
    expect(lines.map((line) => line.offset)).toEqual([8, 4, 0]);
    expect(lines.map((line) => line.end)).toEqual([14, 8, 4]);
  });

  test("a file with no trailing newline still yields its last line", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "one\ntwo");
    expect((await collect(file, 7)).map((line) => line.text)).toEqual(["two", "one"]);
  });

  test("stops before an end offset that is a line start", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "one\ntwo\nthree\n");
    expect((await collect(file, 8)).map((line) => line.text)).toEqual(["two", "one"]);
  });

  test("strips a carriage return and skips blank lines", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "one\r\n\ntwo\r\n");
    expect((await collect(file, 10)).map((line) => line.text)).toEqual(["two", "one"]);
  });

  test("lines longer than a chunk and multi-byte text survive chunk edges", async () => {
    const file = path.join(dir, "a.log");
    const long = `${"é".repeat(70_000)}end`;
    await writeFile(file, `first\n${long}\nlast\n`);
    const size = Buffer.byteLength(`first\n${long}\nlast\n`);
    const lines = await collect(file, size);
    expect(lines.map((line) => line.text)).toEqual(["last", long, "first"]);
    expect(lines[0]?.end).toBe(size);
    expect(lines[0]?.offset).toBe(lines[1]?.end as number);
    expect(lines[1]?.offset).toBe(lines[2]?.end as number);
    expect(lines[2]?.offset).toBe(0);
  });

  test("an empty file yields nothing", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "");
    expect(await collect(file, 0)).toEqual([]);
  });
});

describe("readLinesForward", () => {
  test("returns complete lines and resumes before a half-written one", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "one\ntwo\nthr");
    const first = await readLinesForward(file, 0, 11);
    expect(first.lines.map((line) => line.text)).toEqual(["one", "two"]);
    expect(first.next).toBe(8);
    await writeFile(file, "one\ntwo\nthree\n");
    const second = await readLinesForward(file, first.next, 14);
    expect(second.lines.map((line) => [line.text, line.offset, line.end])).toEqual([["three", 8, 14]]);
  });

  test("reads nothing when there is nothing new", async () => {
    const file = path.join(dir, "a.log");
    await writeFile(file, "one\n");
    expect(await readLinesForward(file, 4, 4)).toEqual({ lines: [], next: 4 });
  });
});
