import { describe, expect, it } from "bun:test";
import { reportAlertsCompleted, reportAlertsPlaying } from "../../src/routes/events";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

type LifecycleRequest = { id: string; envelopeId: string; status: string; error: string };

function recordingDb() {
  const calls: Array<{ id: string; envelopeId: string; status: string }> = [];
  return {
    calls,
    db: {
      updateAlertLifecycle: async (req: LifecycleRequest) => {
        calls.push({ id: req.id, envelopeId: req.envelopeId, status: req.status });
        return {};
      },
    },
  };
}

const failingDb = {
  updateAlertLifecycle: async () => {
    throw new Error("not_found");
  },
};

describe("reportAlertsPlaying", () => {
  it("moves each started alert's row to playing once, and ignores other events", async () => {
    const { calls, db } = recordingDb();

    await reportAlertsPlaying(db, fakeLogger(), [
      { type: "alert", key: "alert-a", value: { alertId: "alert-a", rowId: "row-1" } },
      { type: "alert", key: "alert-a", value: { alertId: "alert-a", rowId: "row-1" } },
      { type: "widget.event", key: "count", value: 1 },
    ]);

    expect(calls).toEqual([{ id: "row-1", envelopeId: "alert-a", status: "playing" }]);
  });

  // A workflow that pins the envelope id plays it more than once, and the
  // plays can overlap: each is reported against its own row.
  it("reports overlapping plays of one envelope against their own rows", async () => {
    const { calls, db } = recordingDb();

    await reportAlertsPlaying(db, fakeLogger(), [
      { type: "alert", key: "alert-a", value: { alertId: "alert-a", rowId: "row-1" } },
      { type: "alert", key: "alert-a", value: { alertId: "alert-a", rowId: "row-2" } },
    ]);

    expect(calls).toEqual([
      { id: "row-1", envelopeId: "alert-a", status: "playing" },
      { id: "row-2", envelopeId: "alert-a", status: "playing" },
    ]);
  });

  // Deliveries recorded before deliveries carried a row id report against the
  // envelope alone, and the db proxy moves its newest row.
  it("reports a delivery without a row id against its envelope", async () => {
    const { calls, db } = recordingDb();

    await reportAlertsPlaying(db, fakeLogger(), [{ type: "alert", key: "alert-a", value: { alertId: "alert-a" } }]);

    expect(calls).toEqual([{ id: "", envelopeId: "alert-a", status: "playing" }]);
  });

  it("survives a missing alert row", async () => {
    await reportAlertsPlaying(failingDb, fakeLogger(), [{ type: "alert", key: "alert-a", value: null }]);
  });
});

describe("reportAlertsCompleted", () => {
  it("moves each finished alert's row to completed once, and ignores other events", async () => {
    const { calls, db } = recordingDb();

    await reportAlertsCompleted(db, fakeLogger(), [
      { type: "alert", key: "alert-a", value: { alertId: "alert-a", rowId: "row-1" } },
      { type: "alert", key: "alert-a", value: { alertId: "alert-a", rowId: "row-1" } },
      { type: "widget.event", key: "count", value: 1 },
    ]);

    expect(calls).toEqual([{ id: "row-1", envelopeId: "alert-a", status: "completed" }]);
  });

  it("survives a missing alert row", async () => {
    await reportAlertsCompleted(failingDb, fakeLogger(), [{ type: "alert", key: "alert-a", value: null }]);
  });
});
