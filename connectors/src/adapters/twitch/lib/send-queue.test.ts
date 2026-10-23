import { describe, expect, test } from "bun:test";
import { SendQueue } from "./send-queue";

/** A job that settles only when the test says so, recording when it started. */
function gate<T>(name: string, started: string[]) {
  let release!: (value: T) => void;
  let fail!: (error: Error) => void;
  const done = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const work = () => {
    started.push(name);
    return done;
  };
  return { work, release, fail };
}

const live = () => new AbortController().signal;

describe("SendQueue", () => {
  test("runs one job at a time, in arrival order", async () => {
    const started: string[] = [];
    const queue = new SendQueue(10);
    const a = gate<string>("a", started);
    const b = gate<string>("b", started);
    const c = gate<string>("c", started);

    const runs = [queue.run(a.work, live()), queue.run(b.work, live()), queue.run(c.work, live())];
    expect(started).toEqual(["a"]);
    expect(queue.depth).toBe(2);

    a.release("A");
    await runs[0];
    expect(started).toEqual(["a", "b"]);
    b.release("B");
    c.release("C");

    expect(await Promise.all(runs)).toEqual([
      { kind: "ran", value: "A" },
      { kind: "ran", value: "B" },
      { kind: "ran", value: "C" },
    ]);
    expect(queue.depth).toBe(0);
  });

  test("refuses a job once cap jobs are waiting, without running it", async () => {
    const started: string[] = [];
    const queue = new SendQueue(1);
    const running = gate<string>("running", started);
    const waiting = gate<string>("waiting", started);
    const refused = gate<string>("refused", started);

    const first = queue.run(running.work, live());
    const second = queue.run(waiting.work, live());
    expect(await queue.run(refused.work, live())).toEqual({ kind: "full" });

    running.release("1");
    waiting.release("2");
    await Promise.all([first, second]);
    expect(started).toEqual(["running", "waiting"]);
  });

  test("with a cap of zero, runs a job only when nothing is running", async () => {
    const started: string[] = [];
    const queue = new SendQueue(0);
    const running = gate<string>("running", started);

    const first = queue.run(running.work, live());
    expect(await queue.run(gate<string>("refused", started).work, live())).toEqual({ kind: "full" });
    running.release("1");
    expect(await first).toEqual({ kind: "ran", value: "1" });
    expect(await queue.run(async () => "2", live())).toEqual({ kind: "ran", value: "2" });
  });

  test("drops a waiting job whose signal aborts, and runs the ones behind it", async () => {
    const started: string[] = [];
    const queue = new SendQueue(10);
    const running = gate<string>("running", started);
    const dropped = gate<string>("dropped", started);
    const after = gate<string>("after", started);
    const cancel = new AbortController();

    const first = queue.run(running.work, live());
    const second = queue.run(dropped.work, cancel.signal);
    const third = queue.run(after.work, live());
    cancel.abort(new Error("deadline"));
    expect(await second).toEqual({ kind: "abandoned" });
    expect(queue.depth).toBe(1);

    running.release("1");
    after.release("3");
    expect(await first).toEqual({ kind: "ran", value: "1" });
    expect(await third).toEqual({ kind: "ran", value: "3" });
    expect(started).toEqual(["running", "after"]);
  });

  test("never runs a job whose signal already aborted", async () => {
    const started: string[] = [];
    const queue = new SendQueue(10);
    const cancel = new AbortController();
    cancel.abort(new Error("gone"));

    expect(await queue.run(gate<string>("never", started).work, cancel.signal)).toEqual({ kind: "abandoned" });
    expect(started).toEqual([]);
  });

  test("an abort after a job started changes nothing about its run", async () => {
    const started: string[] = [];
    const queue = new SendQueue(10);
    const job = gate<string>("job", started);
    const cancel = new AbortController();

    const run = queue.run(job.work, cancel.signal);
    cancel.abort(new Error("late"));
    job.release("done");
    expect(await run).toEqual({ kind: "ran", value: "done" });
  });

  test("passes a job's failure to its caller and still runs the next job", async () => {
    const started: string[] = [];
    const queue = new SendQueue(10);
    const failing = gate<string>("failing", started);

    const first = queue.run(failing.work, live());
    const second = queue.run(async () => "next", live());
    failing.fail(new Error("helix exploded"));

    await expect(first).rejects.toThrow("helix exploded");
    expect(await second).toEqual({ kind: "ran", value: "next" });
  });

  test("refuses a cap that is not a whole number of zero or more", () => {
    for (const cap of [-1, 1.5, Number.NaN]) {
      expect(() => new SendQueue(cap)).toThrow("send queue cap");
    }
  });
});
