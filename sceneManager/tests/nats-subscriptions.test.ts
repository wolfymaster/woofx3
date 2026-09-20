import { describe, expect, it, mock } from "bun:test";
import { reportAlertNotPlayed } from "../src/nats-subscriptions";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

type LifecycleRequest = {
  applicationId: string;
  envelopeId: string;
  status: string;
  error: string;
};

function writer(result: () => Promise<unknown> = async () => ({})) {
  const calls: LifecycleRequest[] = [];
  return {
    calls,
    client: {
      updateAlertLifecycle: (req: LifecycleRequest) => {
        calls.push(req);
        return result();
      },
    },
  };
}

describe("reportAlertNotPlayed", () => {
  it("records the refusal against the envelope id the engine minted", async () => {
    const { calls, client } = writer();

    await reportAlertNotPlayed(client, fakeLogger(), {
      applicationId: "app-1",
      alertId: "env-1",
      reason: "layout must be an object, got nothing",
    });

    expect(calls).toEqual([
      {
        applicationId: "app-1",
        envelopeId: "env-1",
        status: "failed",
        error: "layout must be an object, got nothing",
      },
    ]);
  });

  // The engine writes the row best-effort, so an alert published without one
  // answers NOT_FOUND. That is the expected case, not a fault — and throwing
  // here would kill the subscription and stop every alert behind it.
  it("survives a missing row without throwing", async () => {
    const debug = mock((_message: string, _meta?: unknown) => {});
    const logger = { ...fakeLogger(), debug };
    const { client } = writer(async () => {
      throw new Error("db.updateAlertLifecycle: not_found: alert not found for envelope");
    });

    await reportAlertNotPlayed(client, logger, {
      applicationId: "app-1",
      alertId: "env-1",
      reason: "the layout contains no widgets",
    });

    expect(debug).toHaveBeenCalledTimes(1);
  });

  // A correct alert nobody was listening for is still worth reporting: from
  // the browser it is indistinguishable from one that was never sent.
  it("carries the target name when nothing was listening", async () => {
    const { calls, client } = writer();

    await reportAlertNotPlayed(client, fakeLogger(), {
      applicationId: "app-1",
      alertId: "env-1",
      reason: 'no alert widget named "sidebar" on a running scene',
    });

    expect(calls[0]?.error).toBe('no alert widget named "sidebar" on a running scene');
    expect(calls[0]?.status).toBe("failed");
  });
});
