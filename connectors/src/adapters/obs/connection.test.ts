import { describe, expect, it } from "bun:test";
import type { ObsControlCommand } from "@woofx3/common/cloudevents/Obs/commands";
import { OBS_DEFAULTS, type ObsConnectionConfig } from "../../config/obs";
import { type RandomSource, systemTimers, type Timers } from "../../host/deps";
import { ObsConnection, type ObsSession } from "./connection";
import { executeObsControlCommand, type ObsControlClient, type ObsControlOptions } from "./control";

const runCommand = (
  obs: ObsControlClient | null,
  command: ObsControlCommand,
  options: Partial<ObsControlOptions> = {}
) =>
  executeObsControlCommand(obs, command, {
    timeoutMs: OBS_DEFAULTS.commandTimeoutMs,
    timers: systemTimers,
    ...options,
  });

/** The shipped backoff and open deadline. */
const CONFIG: Pick<ObsConnectionConfig, "backoff" | "openTimeoutMs"> = {
  backoff: { baseMs: OBS_DEFAULTS.backoffInitialMs, maxMs: OBS_DEFAULTS.backoffMaxMs },
  openTimeoutMs: OBS_DEFAULTS.openTimeoutMs,
};

/** Full jitter at half the ceiling, so each delay is easy to read off. */
const half: RandomSource = { next: () => 0.5 };

/** A run whose host never gives up on it; tests that need an abort make their own. */
const forever = () => new AbortController().signal;

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
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
    setInterval: () => {
      throw new Error("the OBS connection sets no intervals");
    },
    clearInterval: () => {
      throw new Error("the OBS connection sets no intervals");
    },
  };
  return {
    timers,
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

function connection(obs: ReturnType<typeof fakeObs>, extra: { onConnected?: () => void } = {}) {
  const timers = manualTimers();
  const log = recordingLogger();
  const conn = new ObsConnection<ObsControlClient>({
    open: obs.open,
    onConnected: () => extra.onConnected?.(),
    logger: log.logger,
    config: CONFIG,
    random: half,
    timers: timers.timers,
  });
  return { conn, timers, log };
}

describe("ObsConnection", () => {
  it("connects straight away when OBS is up", async () => {
    const obs = fakeObs(0);
    let connects = 0;
    const { conn, timers, log } = connection(obs, {
      onConnected: () => {
        connects += 1;
      },
    });

    expect(conn.status()).toBe("connecting");
    conn.start(forever());
    await settle();

    expect(conn.status()).toBe("connected");
    expect(conn.current()).toBe(obs.client);
    expect(connects).toBe(1);
    expect(timers.count()).toBe(0);
    expect(log.loud().map((l) => l.message)).toEqual(["Connected to OBS"]);
  });

  it("retries with growing delays until OBS answers, logging only the transitions", async () => {
    const obs = fakeObs(3);
    const { conn, timers, log } = connection(obs);

    conn.start(forever());
    await settle();
    expect(conn.status()).toBe("retrying");
    expect(conn.current()).toBeNull();

    const delays: number[] = [];
    while (conn.status() !== "connected") {
      delays.push(...timers.delays());
      await timers.fire();
    }

    expect(delays).toEqual([500, 1_000, 2_000]);
    expect(obs.opened()).toBe(1);
    expect(log.loud().map((l) => l.message)).toEqual([
      "OBS not reachable; retrying in the background",
      "Connected to OBS",
    ]);
  });

  it("reconnects when the socket closes, running onConnected for each session", async () => {
    const obs = fakeObs(0);
    let connects = 0;
    const { conn, timers, log } = connection(obs, {
      onConnected: () => {
        connects += 1;
      },
    });
    conn.start(forever());
    await settle();

    obs.dropLatest();
    expect(conn.status()).toBe("retrying");
    expect(conn.current()).toBeNull();
    expect(timers.delays()).toEqual([500]);

    await timers.fire();
    expect(conn.status()).toBe("connected");
    expect(obs.opened()).toBe(2);
    expect(connects).toBe(2);
    expect(log.loud().map((l) => l.message)).toEqual([
      "Connected to OBS",
      "OBS connection lost; reconnecting in the background",
      "Reconnected to OBS",
    ]);
  });

  it("answers obs commands as not connected while retrying", async () => {
    const obs = fakeObs(1);
    const { conn } = connection(obs);
    conn.start(forever());
    await settle();

    const reply = await runCommand(conn.current(), { command: "switch_scene", sceneName: "Raid" });
    expect(reply).toEqual({ ok: false, error: "OBS is not connected (retrying)" });
  });

  it("stop() cancels a pending retry", async () => {
    const obs = fakeObs(5);
    const { conn, timers } = connection(obs);
    conn.start(forever());
    await settle();
    expect(timers.count()).toBe(1);

    await conn.stop();
    expect(conn.status()).toBe("stopped");
    expect(timers.count()).toBe(0);
  });

  it("stop() closes the open session, and its close does not trigger a reconnect", async () => {
    const obs = fakeObs(0);
    const { conn, timers } = connection(obs);
    conn.start(forever());
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
    conn.start(forever());
    await settle();

    expect(conn.status()).toBe("connected");
    expect(log.loud().map((l) => l.message)).toContain("OBS post-connect work failed");
  });

  it("recycle() abandons a hung session and reconnects", async () => {
    const obs = fakeObs(0);
    const { conn, timers, log } = connection(obs);
    conn.start(forever());
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
      config: CONFIG,
      random: half,
      timers: timers.timers,
    });
    conn.start(forever());
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
    conn.start(forever());
    expect(() => conn.start(forever())).toThrow();
  });

  it("reconnects at once when told, closing the open session", async () => {
    const obs = fakeObs(0);
    let connects = 0;
    const { conn, timers, log } = connection(obs, {
      onConnected: () => {
        connects += 1;
      },
    });
    conn.start(forever());
    await settle();

    conn.reconnectNow("OBS module settings changed");
    await settle();

    expect(obs.closed).toEqual([1]);
    expect(obs.opened()).toBe(2);
    expect(conn.status()).toBe("connected");
    expect(connects).toBe(2);
    expect(timers.count()).toBe(0);
    expect(log.loud().map((l) => l.message)).toContain("OBS module settings changed; reconnecting to OBS");
  });

  it("skips a scheduled retry's backoff when told to reconnect", async () => {
    const obs = fakeObs(1);
    const { conn, timers } = connection(obs);
    conn.start(forever());
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
      config: CONFIG,
      random: half,
      timers: timers.timers,
    });
    conn.start(forever());
    await settle();

    conn.reconnectNow("OBS module settings changed");
    await settle();
    release();
    await settle();

    expect((conn.current() as unknown as { name: string }).name).toBe("fresh");
    expect(closed).toEqual(["stale"]);
  });

  it("gives up on an open that never finishes, retries, and closes the late session", async () => {
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
      // OBS accepted the socket and then stopped answering while the scenes loaded.
      open: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return session("late");
        }
        return session("fresh");
      },
      logger: recordingLogger().logger,
      config: { ...CONFIG, openTimeoutMs: 15_000 },
      random: half,
      timers: timers.timers,
    });
    conn.start(forever());
    await settle();
    expect(timers.delays()).toEqual([15_000]);

    await timers.fire();
    expect(conn.status()).toBe("retrying");
    expect(conn.lastFailure()).toBe("unreachable");
    expect(timers.delays()).toEqual([OBS_DEFAULTS.backoffInitialMs / 2]);

    release();
    await settle();
    expect(closed).toEqual(["late"]);
    expect(conn.current()).toBeNull();

    await timers.fire();
    expect(conn.status()).toBe("connected");
    expect((conn.current() as unknown as { name: string }).name).toBe("fresh");
  });

  it("does nothing once stopped", async () => {
    const obs = fakeObs(0);
    const { conn } = connection(obs);
    conn.start(forever());
    await settle();
    await conn.stop();

    conn.reconnectNow("OBS module settings changed");
    await settle();

    expect(obs.opened()).toBe(1);
    expect(conn.status()).toBe("stopped");
  });

  it("reports the last failure until it connects", async () => {
    const obs = fakeObs(1);
    const { conn, timers } = connection(obs);
    expect(conn.lastFailure()).toBeNull();
    conn.start(forever());
    await settle();
    expect(conn.lastFailure()).toBe("unreachable");

    await timers.fire();

    expect(conn.status()).toBe("connected");
    expect(conn.lastFailure()).toBeNull();
  });

  it("keeps its retry delay at the cap however long OBS stays away", async () => {
    const timers = manualTimers();
    const conn = new ObsConnection<ObsControlClient>({
      open: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4455");
      },
      logger: recordingLogger().logger,
      config: CONFIG,
      random: { next: () => 0.999 },
      timers: timers.timers,
    });
    conn.start(forever());
    await settle();

    const delays: number[] = [];
    for (let i = 0; i < 12; i++) {
      delays.push(...timers.delays());
      await timers.fire();
    }
    await conn.stop();

    expect(Math.max(...delays)).toBeLessThan(OBS_DEFAULTS.backoffMaxMs);
    expect(delays.slice(-6)).toEqual(Array(6).fill(Math.floor(0.999 * OBS_DEFAULTS.backoffMaxMs)));
  });

  it("stopped while an attempt is in flight, leaves no timer and closes the session that arrives late", async () => {
    let release: () => void = () => {
      throw new Error("the attempt never started");
    };
    const closed: string[] = [];
    let attemptSignal: AbortSignal | null = null;
    const timers = manualTimers();
    const conn = new ObsConnection<ObsControlClient>({
      open: async (signal) => {
        attemptSignal = signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          client: {} as ObsControlClient,
          onClose: () => {},
          close: async () => {
            closed.push("late");
          },
        };
      },
      logger: recordingLogger().logger,
      config: CONFIG,
      random: half,
      timers: timers.timers,
    });
    conn.start(forever());
    await settle();
    expect(timers.delays()).toEqual([OBS_DEFAULTS.openTimeoutMs]);

    expect((attemptSignal as AbortSignal | null)?.aborted).toBe(false);
    await conn.stop();
    expect((attemptSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(timers.count()).toBe(0);
    release();
    await settle();

    expect(closed).toEqual(["late"]);
    expect(conn.current()).toBeNull();
    expect(conn.status()).toBe("stopped");
    expect(timers.count()).toBe(0);
  });

  it("stops when its start signal aborts: the pending retry is cancelled and nothing dials again", async () => {
    const obs = fakeObs(100);
    const { conn, timers } = connection(obs);
    const run = new AbortController();
    conn.start(run.signal);
    await settle();
    expect(timers.count()).toBe(1);

    run.abort();
    await settle();
    expect(conn.status()).toBe("stopped");
    expect(timers.count()).toBe(0);
    conn.reconnectNow("OBS module settings changed");
    await settle();
    expect(timers.count()).toBe(0);
  });

  it("closes the open session when its start signal aborts", async () => {
    const obs = fakeObs(0);
    const { conn } = connection(obs);
    const run = new AbortController();
    conn.start(run.signal);
    await settle();

    run.abort();
    await settle();
    expect(obs.closed).toEqual([1]);
    expect(conn.current()).toBeNull();
  });

  it("never dials when started with a signal that already aborted", async () => {
    const obs = fakeObs(0);
    const { conn, timers } = connection(obs);
    conn.start(AbortSignal.abort());
    await settle();

    expect(obs.opened()).toBe(0);
    expect(conn.status()).toBe("stopped");
    expect(timers.count()).toBe(0);
  });

  it("refuses a backoff whose cap is below its first delay, and an open deadline that is not positive", () => {
    const build = (config: typeof CONFIG) =>
      new ObsConnection<ObsControlClient>({
        open: async () => {
          throw new Error("unused");
        },
        logger: recordingLogger().logger,
        config,
        random: half,
        timers: manualTimers().timers,
      });
    expect(() => build({ ...CONFIG, backoff: { baseMs: 2_000, maxMs: 1_000 } })).toThrow("backoff requires");
    expect(() => build({ ...CONFIG, openTimeoutMs: 0 })).toThrow("openTimeoutMs");
  });
});
