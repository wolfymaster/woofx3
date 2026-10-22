import { describe, expect, it } from "bun:test";
import { OBS_BROWSER_SOURCE_REFRESH_SUBJECT } from "@woofx3/common/cloudevents/Obs/commands";
import { type RefreshRequestTimers, startRefreshRequests } from "../../src/obs/refresh-request";

const config = { requestTimeoutMs: 2_000, retryBaseMs: 1_000, retryMaxMs: 30_000 };
const request = { overlayPort: 9101, bootId: "boot-1" };

function recordingLogger() {
  const lines: { level: string; message: string }[] = [];
  const at = (level: string) => (message: string) => {
    lines.push({ level, message });
  };
  return { lines, logger: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") } as never };
}

/** Timers that fire only when the test says so. */
function manualTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const timers: RefreshRequestTimers = {
    set: (fn, ms) => {
      next += 1;
      pending.set(next, { fn, ms });
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    pending,
    delays: () => [...pending.values()].map((t) => t.ms),
    async fireNext() {
      const [id, timer] = [...pending.entries()][0] ?? [];
      if (id === undefined || !timer) {
        throw new Error("no timer pending");
      }
      pending.delete(id);
      timer.fn();
      await flush();
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

type Reply = { kind: "ok"; body: unknown } | { kind: "error"; message: string } | { kind: "raw"; text: string };

function fakeBus(replies: Reply[]) {
  const calls: { subject: string; body: unknown; timeout: number | undefined }[] = [];
  return {
    calls,
    bus: {
      request: async (subject: string, data: Uint8Array, opts?: { timeout?: number }) => {
        calls.push({ subject, body: JSON.parse(new TextDecoder().decode(data)), timeout: opts?.timeout });
        const reply = replies.shift() ?? { kind: "error", message: "no responders" };
        if (reply.kind === "error") {
          throw new Error(reply.message);
        }
        const text = reply.kind === "raw" ? reply.text : JSON.stringify(reply.body);
        return { subject: "_INBOX", data: new TextEncoder().encode(text) };
      },
    } as never,
  };
}

const accepted: Reply = { kind: "ok", body: { status: "accepted", bootId: "boot-1" } };
const half = { next: () => 0.5 };

describe("startRefreshRequests", () => {
  it("asks once and stops when the first reply accepts", async () => {
    const { bus, calls } = fakeBus([accepted]);
    const time = manualTimers();
    const { lines, logger } = recordingLogger();

    const requester = startRefreshRequests(request, { bus, config, random: half, timers: time.timers, logger });
    await flush();

    expect(calls).toEqual([{ subject: OBS_BROWSER_SOURCE_REFRESH_SUBJECT, body: request, timeout: 2_000 }]);
    expect(time.pending.size).toBe(0);
    expect(lines.filter((l) => l.level === "info")).toHaveLength(1);
    await requester.stop();
  });

  it("retries on no responders until a responder appears, then stops retrying", async () => {
    const { bus, calls } = fakeBus([
      { kind: "error", message: "no responders" },
      { kind: "error", message: "timeout" },
      accepted,
    ]);
    const time = manualTimers();
    const { lines, logger } = recordingLogger();

    const requester = startRefreshRequests(request, { bus, config, random: half, timers: time.timers, logger });
    await flush();
    expect(calls).toHaveLength(1);
    expect(time.delays()).toEqual([500]);

    await time.fireNext();
    expect(calls).toHaveLength(2);
    // The ceiling doubled after the first failure.
    expect(time.delays()).toEqual([1_000]);

    await time.fireNext();
    expect(calls).toHaveLength(3);
    expect(time.pending.size).toBe(0);
    expect(lines.filter((l) => l.level === "debug")).toHaveLength(2);
    expect(lines.filter((l) => l.level === "info")).toHaveLength(1);
    await requester.stop();
    expect(calls).toHaveLength(3);
  });

  it("keeps the delay at the cap", async () => {
    const { bus } = fakeBus([]);
    const time = manualTimers();
    const { logger } = recordingLogger();
    const small = { requestTimeoutMs: 100, retryBaseMs: 10, retryMaxMs: 40 };

    const requester = startRefreshRequests(request, { bus, config: small, random: half, timers: time.timers, logger });
    await flush();
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      seen.push(...time.delays());
      await time.fireNext();
    }
    expect(seen).toEqual([5, 10, 20, 20, 20]);
    await requester.stop();
  });

  it("warns once when retrying has reached the cap", async () => {
    const { bus } = fakeBus([]);
    const time = manualTimers();
    const { logger, lines } = recordingLogger();
    const small = { requestTimeoutMs: 100, retryBaseMs: 10, retryMaxMs: 40 };

    const requester = startRefreshRequests(request, { bus, config: small, random: half, timers: time.timers, logger });
    await flush();
    for (let i = 0; i < 6; i += 1) {
      await time.fireNext();
    }
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
    await requester.stop();
  });

  for (const [name, reply] of [
    ["an invalid reply", { kind: "ok", body: { status: "invalid", error: "bad port" } }],
    ["a reply that is not JSON", { kind: "raw", text: "nope" }],
    ["a reply of the wrong shape", { kind: "ok", body: { status: "later" } }],
    ["a reply for another boot id", { kind: "ok", body: { status: "accepted", bootId: "other" } }],
  ] as [string, Reply][]) {
    it(`retries after ${name}`, async () => {
      const { bus, calls } = fakeBus([reply, accepted]);
      const time = manualTimers();
      const { logger } = recordingLogger();

      const requester = startRefreshRequests(request, { bus, config, random: half, timers: time.timers, logger });
      await flush();
      expect(calls).toHaveLength(1);
      await time.fireNext();
      expect(calls).toHaveLength(2);
      await requester.stop();
    });
  }

  it("stops retrying on shutdown and cancels the pending wait", async () => {
    const { bus, calls } = fakeBus([]);
    const time = manualTimers();
    const { logger } = recordingLogger();

    const requester = startRefreshRequests(request, { bus, config, random: half, timers: time.timers, logger });
    await flush();
    expect(time.pending.size).toBe(1);

    await requester.stop();

    expect(time.pending.size).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("makes no further request when stopped while one is in flight", async () => {
    let release: (() => void) | null = null;
    let requests = 0;
    const bus = {
      request: () => {
        requests += 1;
        return new Promise((_resolve, reject) => {
          release = () => reject(new Error("closed"));
        });
      },
    } as never;
    const time = manualTimers();
    const { logger } = recordingLogger();

    const requester = startRefreshRequests(request, { bus, config, random: half, timers: time.timers, logger });
    await flush();
    const stopping = requester.stop();
    (release as (() => void) | null)?.();
    await stopping;

    expect(requests).toBe(1);
    expect(time.pending.size).toBe(0);
  });
});
