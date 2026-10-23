import { afterEach, describe, expect, it } from "bun:test";
import { MODULE_SESSION_DEFAULTS, type ModuleSessionLimits } from "../config/companion";
import { countingIds, FakeTime, RecordingLogger } from "../host/testing";
import { endpointKey } from "./claims";
import { type EndpointSessionsDeps, EndpointSessions, failureCodeFor } from "./endpoint-sessions";
import { echo, eventually, FakeDevice } from "./fake-device";
import type { EndpointResolution, LocalEndpointRef, RouteChangeListener } from "./types";

const VTS: LocalEndpointRef = { moduleId: "vtube_studio", endpointId: "vts" };
const LIGHTS: LocalEndpointRef = { moduleId: "lights", endpointId: "bridge" };

const devices: FakeDevice[] = [];
const pools: EndpointSessions[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.stop()));
  for (const stopped of devices.splice(0)) {
    stopped.stop();
  }
});

function device(script = echo): FakeDevice {
  const started = new FakeDevice(script);
  devices.push(started);
  return started;
}

const directTo = (target: FakeDevice): EndpointResolution => ({
  ok: true,
  route: "direct",
  url: `ws://127.0.0.1:${target.port}`,
  address: `127.0.0.1:${target.port}`,
});

function setup(
  target: FakeDevice,
  overrides: { limits?: Partial<ModuleSessionLimits>; resolve?: EndpointSessionsDeps["resolve"] } = {}
) {
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const listeners = new Map<string, Set<RouteChangeListener>>();
  let resolves = 0;
  const sessions = new EndpointSessions({
    limits: { ...MODULE_SESSION_DEFAULTS, ...overrides.limits },
    resolve:
      overrides.resolve ??
      (async () => {
        resolves++;
        return directTo(target);
      }),
    onRouteChange: (ref, listener) => {
      const key = endpointKey(ref);
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    },
    openSocket: (url) => new WebSocket(url),
    clock: time,
    timers: time,
    ids: countingIds(),
    logger,
  });
  pools.push(sessions);
  const moveRoute = (ref: LocalEndpointRef) => {
    for (const listener of [...(listeners.get(endpointKey(ref)) ?? [])]) {
      listener("relay configuration changed");
    }
  };
  const watching = (ref: LocalEndpointRef) => listeners.get(endpointKey(ref))?.size ?? 0;
  return { sessions, time, logger, moveRoute, watching, resolves: () => resolves };
}

const live = () => new AbortController().signal;

async function opened(sessions: EndpointSessions, ref = VTS) {
  const acquired = await sessions.acquire(ref, live());
  if (!acquired.ok) {
    throw new Error(`no session: ${acquired.code} ${acquired.message}`);
  }
  return acquired.session;
}

describe("EndpointSessions opening", () => {
  it("opens one session per endpoint and reuses it", async () => {
    const target = device();
    const { sessions, resolves } = setup(target);
    const first = await opened(sessions);
    const second = await opened(sessions);
    expect(second).toBe(first);
    expect(first.epoch).toBe("id-1");
    expect(resolves()).toBe(1);
    expect(target.connections).toEqual(["/"]);
    expect(sessions.status()).toMatchObject({ opens: 1, opening: 0, sessions: [{ sessionEpoch: "id-1", pending: 0 }] });
  });

  it("shares one open between callers that arrive while it runs", async () => {
    const target = device();
    const { sessions, resolves } = setup(target);
    const [a, b] = await Promise.all([sessions.acquire(VTS, live()), sessions.acquire(VTS, live())]);
    expect(a.ok && b.ok && a.session === b.session).toBe(true);
    expect(resolves()).toBe(1);
  });

  it("answers the resolution's refusal with its module-facing code, and retries on the next call", async () => {
    const target = device();
    let refuse = true;
    const { sessions } = setup(target, {
      resolve: async () =>
        refuse
          ? { ok: false, reason: "relay", message: "the companion relay refused the bridge (503)" }
          : directTo(target),
    });
    expect(await sessions.acquire(VTS, live())).toEqual({
      ok: false,
      code: "unavailable",
      message: "the companion relay refused the bridge (503)",
    });
    refuse = false;
    expect(await sessions.acquire(VTS, live())).toMatchObject({ ok: true });
    expect(sessions.status().openFailures).toEqual({ unavailable: 1 });
  });

  it("answers unavailable when nothing listens at the address", async () => {
    const target = device();
    const port = target.port;
    target.stop();
    const { sessions } = setup(target, {
      resolve: async () => ({ ok: true, route: "direct", url: `ws://127.0.0.1:${port}`, address: `127.0.0.1:${port}` }),
    });
    expect(await sessions.acquire(VTS, live())).toMatchObject({ ok: false, code: "unavailable" });
    expect(sessions.status()).toMatchObject({ sessions: [], opening: 0 });
  });

  it("gives up an open at its own timeout, not the caller's", async () => {
    const target = device();
    const { sessions, time } = setup(target, {
      limits: { openTimeoutMs: 10_000 },
      resolve: (_ref, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    });
    const pending = sessions.acquire(VTS, live());
    await time.advance(10_000);
    expect(await pending).toEqual({
      ok: false,
      code: "unavailable",
      message: "vtube_studio/vts did not open within 10000ms",
    });
  });

  it("answers a caller whose budget ends first 'still connecting', and the next call finds the open", async () => {
    const target = device();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sessions } = setup(target, {
      resolve: async () => {
        await gate;
        return directTo(target);
      },
    });
    const budget = new AbortController();
    const first = sessions.acquire(VTS, budget.signal);
    budget.abort(new Error("budget"));
    expect(await first).toEqual({
      ok: false,
      code: "unavailable",
      message: "vtube_studio/vts is still connecting; try again shortly",
    });
    expect(sessions.status().opening).toBe(1);
    release();
    expect(await sessions.acquire(VTS, live())).toMatchObject({ ok: true, session: { epoch: "id-1" } });
  });

  it("refuses a new endpoint past the session cap, counting opens in flight", async () => {
    const target = device();
    const { sessions } = setup(target, { limits: { maxSessions: 1 } });
    await opened(sessions, VTS);
    expect(await sessions.acquire(LIGHTS, live())).toEqual({
      ok: false,
      code: "busy",
      message: "too many local endpoint sessions open (1); try again later",
    });
    expect(await sessions.acquire(VTS, live())).toMatchObject({ ok: true });
    expect(sessions.status().openFailures).toEqual({ busy: 1 });
  });

  it("refuses limits that are not positive whole numbers", () => {
    const target = device();
    expect(() => setup(target, { limits: { maxSessions: 0 } })).toThrow(
      "EndpointSessions: maxSessions must be a whole number above 0, got 0"
    );
  });
});

describe("EndpointSessions epochs", () => {
  it("closes an idle session and reopens with a new epoch", async () => {
    const target = device();
    const { sessions, time } = setup(target, { limits: { idleMs: 120_000 } });
    const first = await opened(sessions);
    await time.advance(119_999);
    expect((await opened(sessions)).epoch).toBe(first.epoch);
    await time.advance(120_000);
    await eventually(() => target.open === 0, "the idle session to close");
    expect(sessions.status().closes.idle).toBe(1);
    const second = await opened(sessions);
    expect(second.epoch).not.toBe(first.epoch);
  });

  it("keeps a session with a request pending past the idle time", async () => {
    const target = device(() => []);
    const { sessions, time } = setup(target, { limits: { idleMs: 1_000 } });
    const session = await opened(sessions);
    const waiting = session.request({ field: "id", value: "r1" }, '{"id":"r1"}', live());
    await time.advance(1_000);
    expect(sessions.status().sessions).toHaveLength(1);
    target.push('{"id":"r1"}');
    expect(await waiting).toMatchObject({ ok: true });
    await time.advance(1_000);
    expect(sessions.status().sessions).toHaveLength(0);
  });

  it("drops the session when the route moves, failing what is pending, and reopens with a new epoch", async () => {
    const target = device(() => []);
    const { sessions, moveRoute, watching } = setup(target);
    const first = await opened(sessions);
    const waiting = first.request({ field: "id", value: 1 }, "{}", live());
    moveRoute(VTS);
    expect(await waiting).toEqual({
      ok: false,
      code: "unavailable",
      message: "the session closed: relay configuration changed",
      sessionEpoch: first.epoch,
    });
    expect(watching(VTS)).toBe(0);
    expect(sessions.status().closes.route_change).toBe(1);
    expect((await opened(sessions)).epoch).not.toBe(first.epoch);
  });

  it("abandons an open whose route moves while it runs", async () => {
    const target = device();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sessions, moveRoute } = setup(target, {
      resolve: async (_ref, signal) => {
        await gate;
        signal.throwIfAborted();
        return directTo(target);
      },
    });
    const pending = sessions.acquire(VTS, live());
    moveRoute(VTS);
    release();
    expect(await pending).toEqual({ ok: false, code: "unavailable", message: "relay configuration changed" });
    expect(target.connections).toEqual([]);
  });

  it("drops the session when the device hangs up", async () => {
    const target = device();
    const { sessions } = setup(target);
    const first = await opened(sessions);
    target.hangUp();
    await eventually(() => sessions.status().sessions.length === 0, "the remote close");
    expect(sessions.status().closes.remote).toBe(1);
    expect((await opened(sessions)).epoch).not.toBe(first.epoch);
  });
});

describe("EndpointSession frames", () => {
  it("send writes one text frame", async () => {
    const target = device(() => []);
    const { sessions } = setup(target);
    const session = await opened(sessions);
    expect(session.send('{"hello":1}', live())).toEqual({ ok: true, sessionEpoch: session.epoch });
    await eventually(() => target.frames.length === 1, "the frame");
    expect(target.frames).toEqual(['{"hello":1}']);
  });

  it("never writes once the budget is gone", async () => {
    const target = device();
    const { sessions } = setup(target);
    const session = await opened(sessions);
    const spent = AbortSignal.abort(new Error("budget"));
    expect(session.send("late", spent)).toMatchObject({ ok: false, code: "timeout" });
    expect(await session.request({ field: "id", value: 1 }, "late", spent)).toMatchObject({
      ok: false,
      code: "timeout",
    });
    await Bun.sleep(20);
    expect(target.frames).toEqual([]);
  });

  it("request answers with the first matching JSON object, counting what did not match", async () => {
    const target = device(() => [
      "not json",
      "[1,2]",
      '{"requestID":"other"}',
      '{"requestID":1}',
      new Uint8Array([1, 2, 3]),
      '{"requestID":"r1","data":{"ok":true}}',
      '{"requestID":"r1","data":"second"}',
    ]);
    const { sessions } = setup(target);
    const session = await opened(sessions);
    expect(await session.request({ field: "requestID", value: "r1" }, '{"requestID":"r1"}', live())).toEqual({
      ok: true,
      reply: '{"requestID":"r1","data":{"ok":true}}',
      sessionEpoch: session.epoch,
    });
    await eventually(() => sessions.status().frames.unmatched === 5, "every frame to arrive");
    expect(sessions.status().frames).toEqual({ oversized: 0, binary: 1, unmatched: 5 });
  });

  it("refuses a second pending request with the same match, but not a different one", async () => {
    const target = device(() => []);
    const { sessions } = setup(target);
    const session = await opened(sessions);
    const first = session.request({ field: "id", value: "r1" }, "{}", live());
    expect(await session.request({ field: "id", value: "r1" }, "{}", live())).toEqual({
      ok: false,
      code: "busy",
      message: 'a request matching id="r1" is already pending',
      sessionEpoch: session.epoch,
    });
    const other = session.request({ field: "id", value: 7 }, "{}", live());
    target.push('{"id":7}');
    target.push('{"id":"r1"}');
    expect(await other).toMatchObject({ ok: true, reply: '{"id":7}' });
    expect(await first).toMatchObject({ ok: true, reply: '{"id":"r1"}' });
  });

  it("caps the requests pending on one session", async () => {
    const target = device(() => []);
    const { sessions } = setup(target, { limits: { maxPendingPerSession: 2 } });
    const session = await opened(sessions);
    void session.request({ field: "id", value: 1 }, "{}", live());
    void session.request({ field: "id", value: 2 }, "{}", live());
    expect(await session.request({ field: "id", value: 3 }, "{}", live())).toMatchObject({
      ok: false,
      code: "busy",
      message: "too many requests pending on this session (2)",
    });
  });

  it("answers timeout when the budget ends before a match", async () => {
    const target = device(() => ['{"id":"other"}']);
    const { sessions } = setup(target);
    const session = await opened(sessions);
    const budget = new AbortController();
    const waiting = session.request({ field: "id", value: "r1" }, "{}", budget.signal);
    await eventually(() => sessions.status().frames.unmatched === 1, "the unsolicited frame");
    budget.abort(new Error("budget"));
    expect(await waiting).toEqual({
      ok: false,
      code: "timeout",
      message: "no matching reply arrived before the budget ran out",
      sessionEpoch: session.epoch,
    });
    expect(session.pending).toBe(0);
  });

  it("drops an oversized inbound frame and refuses an oversized outbound one", async () => {
    const target = device(() => [`{"id":1,"pad":"${"x".repeat(64)}"}`]);
    const { sessions } = setup(target, { limits: { maxMessageBytes: 32 } });
    const session = await opened(sessions);
    expect(session.send("x".repeat(33), live())).toMatchObject({ ok: false, code: "invalid" });
    const budget = new AbortController();
    const waiting = session.request({ field: "id", value: 1 }, "{}", budget.signal);
    await eventually(() => sessions.status().frames.oversized === 1, "the oversized frame");
    budget.abort(new Error("budget"));
    expect(await waiting).toMatchObject({ ok: false, code: "timeout" });
  });
});

describe("EndpointSessions stop", () => {
  it("closes every session, fails pending requests and refuses new ones", async () => {
    const target = device(() => []);
    const { sessions } = setup(target);
    const session = await opened(sessions);
    const waiting = session.request({ field: "id", value: 1 }, "{}", live());
    await sessions.stop();
    expect(await waiting).toMatchObject({ ok: false, code: "unavailable" });
    await eventually(() => target.open === 0, "the socket to close");
    expect(await sessions.acquire(VTS, live())).toEqual({
      ok: false,
      code: "unavailable",
      message: "the companion gateway is stopping",
    });
    expect(sessions.status().closes.stopped).toBe(1);
  });
});

describe("failureCodeFor", () => {
  it("passes endpoint refusals through and reads the bridge's own failures as unavailable", () => {
    expect(failureCodeFor("adapter_owned")).toBe("adapter_owned");
    expect(failureCodeFor("busy")).toBe("busy");
    expect(failureCodeFor("relay")).toBe("unavailable");
  });
});
