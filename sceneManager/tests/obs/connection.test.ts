import { describe, expect, it } from "bun:test";
import { DEFAULT_OBS_BACKOFF, ObsConnection, type ObsSession, obsRetryDelay } from "../../src/obs/connection";
import { executeObsControlCommand, type ObsControlClient } from "../../src/obs/control";

type Level = "info" | "warn" | "error" | "debug";

function recordingLogger() {
  const lines: { level: Level; message: string }[] = [];
  const at = (level: Level) => (message: string) => {
    lines.push({ level, message });
  };
  const logger = { info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") } as never;
  return { logger, lines, loud: () => lines.filter((l) => l.level !== "debug") };
}

/** Timers the test fires by hand, so backoff delays are observable and instant. */
function manualTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    delays: () => [...pending.values()].map((t) => t.ms),
    count: () => pending.size,
    /** Fire every pending timer, then let the attempts they start settle. */
    async fire() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, timer] of due) {
        timer.fn();
      }
      await settle();
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** A fake OBS whose sessions fail `failures` times, then open; each open session can be closed from the test. */
function fakeObs(failures: number) {
  let remaining = failures;
  let opened = 0;
  const closers: (() => void)[] = [];
  const closed: number[] = [];
  const client = {
    async request() {
      return {};
    },
  } as unknown as ObsControlClient;
  const open = async (): Promise<ObsSession<ObsControlClient>> => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error("connect ECONNREFUSED 127.0.0.1:4455");
    }
    opened += 1;
    const id = opened;
    let listener: (() => void) | null = null;
    closers.push(() => listener?.());
    return {
      client,
      onClose: (fn) => {
        listener = fn;
      },
      close: async () => {
        closed.push(id);
      },
    };
  };
  return { open, client, opened: () => opened, closed, dropLatest: () => closers.at(-1)?.() };
}

function connection(obs: ReturnType<typeof fakeObs>, extra: { onConnected?: (first: boolean) => void } = {}) {
  const timers = manualTimers();
  const log = recordingLogger();
  const conn = new ObsConnection<ObsControlClient>({
    open: obs.open,
    onConnected: (_client, { first }) => extra.onConnected?.(first),
    logger: log.logger,
    random: () => 1,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { conn, timers, log };
}

describe("obsRetryDelay", () => {
  it("doubles from 1s and caps at 30s", () => {
    const ceilings = [0, 1, 2, 3, 4, 5, 6, 20].map((n) => obsRetryDelay(n, DEFAULT_OBS_BACKOFF, 1));
    expect(ceilings).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("jitters down by at most half", () => {
    expect(obsRetryDelay(2, DEFAULT_OBS_BACKOFF, 0)).toBe(2_000);
    expect(obsRetryDelay(10, DEFAULT_OBS_BACKOFF, 0)).toBe(15_000);
  });
});

describe("ObsConnection", () => {
  it("connects straight away when OBS is up", async () => {
    const obs = fakeObs(0);
    const firsts: boolean[] = [];
    const { conn, timers, log } = connection(obs, { onConnected: (first) => firsts.push(first) });

    expect(conn.status()).toBe("connecting");
    conn.start();
    await settle();

    expect(conn.status()).toBe("connected");
    expect(conn.current()).toBe(obs.client);
    expect(firsts).toEqual([true]);
    expect(timers.count()).toBe(0);
    expect(log.loud().map((l) => l.message)).toEqual(["Connected to OBS"]);
  });

  it("retries with growing delays until OBS answers, logging only the transitions", async () => {
    const obs = fakeObs(3);
    const { conn, timers, log } = connection(obs);

    conn.start();
    await settle();
    expect(conn.status()).toBe("retrying");
    expect(conn.current()).toBeNull();

    const delays: number[] = [];
    while (conn.status() !== "connected") {
      delays.push(...timers.delays());
      await timers.fire();
    }

    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(obs.opened()).toBe(1);
    expect(log.loud().map((l) => l.message)).toEqual([
      "OBS not reachable; retrying in the background",
      "Connected to OBS",
    ]);
  });

  it("reconnects when the socket closes, and tells onConnected it is not the first session", async () => {
    const obs = fakeObs(0);
    const firsts: boolean[] = [];
    const { conn, timers, log } = connection(obs, { onConnected: (first) => firsts.push(first) });
    conn.start();
    await settle();

    obs.dropLatest();
    expect(conn.status()).toBe("retrying");
    expect(conn.current()).toBeNull();
    expect(timers.delays()).toEqual([1_000]);

    await timers.fire();
    expect(conn.status()).toBe("connected");
    expect(obs.opened()).toBe(2);
    expect(firsts).toEqual([true, false]);
    expect(log.loud().map((l) => l.message)).toEqual([
      "Connected to OBS",
      "OBS connection lost; reconnecting in the background",
      "Reconnected to OBS",
    ]);
  });

  it("answers obs commands as not connected while retrying", async () => {
    const obs = fakeObs(1);
    const { conn } = connection(obs);
    conn.start();
    await settle();

    const reply = await executeObsControlCommand(conn.current(), { command: "switch_scene", sceneName: "Raid" });
    expect(reply).toEqual({ ok: false, error: "OBS is not connected (retrying)" });
  });

  it("stop() cancels a pending retry", async () => {
    const obs = fakeObs(5);
    const { conn, timers } = connection(obs);
    conn.start();
    await settle();
    expect(timers.count()).toBe(1);

    await conn.stop();
    expect(conn.status()).toBe("stopped");
    expect(timers.count()).toBe(0);
  });

  it("stop() closes the open session, and its close does not trigger a reconnect", async () => {
    const obs = fakeObs(0);
    const { conn, timers } = connection(obs);
    conn.start();
    await settle();

    await conn.stop();
    obs.dropLatest();

    expect(obs.closed).toEqual([1]);
    expect(conn.current()).toBeNull();
    expect(conn.status()).toBe("stopped");
    expect(timers.count()).toBe(0);
  });

  it("a failing onConnected does not drop the session", async () => {
    const obs = fakeObs(0);
    const { conn, log } = connection(obs, {
      onConnected: () => {
        throw new Error("refresh failed");
      },
    });
    conn.start();
    await settle();

    expect(conn.status()).toBe("connected");
    expect(log.loud().map((l) => l.message)).toContain("OBS post-connect work failed");
  });

  it("recycle() abandons a hung session and reconnects", async () => {
    const obs = fakeObs(0);
    const { conn, timers, log } = connection(obs);
    conn.start();
    await settle();

    conn.recycle("an OBS request timed out");
    expect(conn.status()).toBe("retrying");
    expect(conn.current()).toBeNull();
    await settle();
    expect(obs.closed).toEqual([1]);

    // The abandoned socket's own close arriving later must not schedule a second retry.
    obs.dropLatest();
    expect(timers.count()).toBe(1);

    await timers.fire();
    expect(conn.status()).toBe("connected");
    expect(obs.opened()).toBe(2);
    expect(log.loud().map((l) => l.message)).toEqual([
      "Connected to OBS",
      "OBS session abandoned (an OBS request timed out); reconnecting in the background",
      "Reconnected to OBS",
    ]);
  });

  it("names a wrong password once, and again only when the reason changes", async () => {
    const authFailure = Object.assign(new Error("Authentication failed."), { code: 4009 });
    const errors = [authFailure, authFailure, new Error("ECONNREFUSED"), authFailure];
    const timers = manualTimers();
    const log = recordingLogger();
    const conn = new ObsConnection<ObsControlClient>({
      open: async () => {
        throw errors.shift() ?? new Error("ECONNREFUSED");
      },
      logger: log.logger,
      random: () => 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    conn.start();
    await settle();
    for (let i = 0; i < 4; i++) {
      await timers.fire();
    }
    await conn.stop();

    expect(log.loud().map((l) => l.message.split(":")[0])).toEqual([
      "OBS refused the connection",
      "OBS not reachable; retrying in the background",
      "OBS refused the connection",
      "OBS not reachable; retrying in the background",
    ]);
    expect(log.loud()[0].message).toContain("check the WebSocket password in the OBS module's settings");
  });

  it("refuses to start twice", () => {
    const { conn } = connection(fakeObs(0));
    conn.start();
    expect(() => conn.start()).toThrow();
  });

  it("reconnects at once when told, closing the open session", async () => {
    const obs = fakeObs(0);
    const firsts: boolean[] = [];
    const { conn, timers, log } = connection(obs, { onConnected: (first) => firsts.push(first) });
    conn.start();
    await settle();

    conn.reconnectNow("OBS module settings changed");
    await settle();

    expect(obs.closed).toEqual([1]);
    expect(obs.opened()).toBe(2);
    expect(conn.status()).toBe("connected");
    expect(firsts).toEqual([true, false]);
    expect(timers.count()).toBe(0);
    expect(log.loud().map((l) => l.message)).toContain("OBS module settings changed; reconnecting to OBS");
  });

  it("skips a scheduled retry's backoff when told to reconnect", async () => {
    const obs = fakeObs(1);
    const { conn, timers } = connection(obs);
    conn.start();
    await settle();
    expect(conn.status()).toBe("retrying");
    expect(timers.count()).toBe(1);

    conn.reconnectNow("OBS module settings changed");
    await settle();

    expect(timers.count()).toBe(0);
    expect(conn.status()).toBe("connected");
    expect(obs.opened()).toBe(1);
  });

  it("discards an attempt still in flight when told to reconnect", async () => {
    let release: () => void = () => {
      throw new Error("the first attempt never started");
    };
    const closed: string[] = [];
    const session = (name: string): ObsSession<ObsControlClient> => ({
      client: { name } as unknown as ObsControlClient,
      onClose: () => {},
      close: async () => {
        closed.push(name);
      },
    });
    let calls = 0;
    const timers = manualTimers();
    const conn = new ObsConnection<ObsControlClient>({
      open: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return session("stale");
        }
        return session("fresh");
      },
      logger: recordingLogger().logger,
      random: () => 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    conn.start();
    await settle();

    conn.reconnectNow("OBS module settings changed");
    await settle();
    release();
    await settle();

    expect((conn.current() as unknown as { name: string }).name).toBe("fresh");
    expect(closed).toEqual(["stale"]);
  });

  it("does nothing once stopped", async () => {
    const obs = fakeObs(0);
    const { conn } = connection(obs);
    conn.start();
    await settle();
    await conn.stop();

    conn.reconnectNow("OBS module settings changed");
    await settle();

    expect(obs.opened()).toBe(1);
    expect(conn.status()).toBe("stopped");
  });
});
