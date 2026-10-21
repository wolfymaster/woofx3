import { describe, expect, it } from "bun:test";
import { renewSession, startSessionRefresh } from "../../public/scene-manager/session-refresh";

function outcome(refresh: () => Promise<Response>) {
  const health: boolean[] = [];
  let expired = 0;
  const run = renewSession({
    refresh,
    onHealth: (healthy) => health.push(healthy),
    onExpired: () => {
      expired += 1;
    },
  });
  return run.then(() => ({ health, expired }));
}

describe("renewSession", () => {
  it("reports a renewed session as healthy", async () => {
    expect(await outcome(async () => new Response(null, { status: 200 }))).toEqual({ health: [true], expired: 0 });
  });

  it("authenticates again when the session has lapsed, instead of staying disconnected", async () => {
    expect(await outcome(async () => new Response(null, { status: 401 }))).toEqual({ health: [], expired: 1 });
  });

  it("shows itself disconnected and keeps trying when the engine is unreachable or failing", async () => {
    expect(
      await outcome(async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      })
    ).toEqual({ health: [false], expired: 0 });
    expect(await outcome(async () => new Response(null, { status: 503 }))).toEqual({ health: [false], expired: 0 });
  });
});

describe("startSessionRefresh", () => {
  it("never starts a renewal while the last one has not answered", async () => {
    let tick: () => void = () => {};
    let answer: (response: Response) => void = () => {};
    let calls = 0;
    startSessionRefresh({
      refresh: () => {
        calls += 1;
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      },
      onHealth: () => {},
      onExpired: () => {},
      intervalMs: 50_000,
      setInterval: (fn) => {
        tick = fn;
        return 0;
      },
    });
    tick();
    tick();
    expect(calls).toBe(1);
    answer(new Response(null, { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
    tick();
    expect(calls).toBe(2);
  });
});
