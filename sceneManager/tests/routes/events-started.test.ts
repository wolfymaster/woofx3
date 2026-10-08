import { describe, expect, it } from "bun:test";
import { reportAlertsCompleted, reportAlertsPlaying } from "../../src/routes/events";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

describe("reportAlertsPlaying", () => {
  it("moves each started alert's row to playing once, and ignores other events", async () => {
    const calls: Array<{ envelopeId: string; status: string }> = [];
    const db = {
      updateAlertLifecycle: async (req: { envelopeId: string; status: string; error: string }) => {
        calls.push({ envelopeId: req.envelopeId, status: req.status });
        return {};
      },
    };

    await reportAlertsPlaying(db, fakeLogger(), [
      { type: "alert", key: "alert-a" },
      { type: "alert", key: "alert-a" },
      { type: "widget.event", key: "count" },
    ]);

    expect(calls).toEqual([{ envelopeId: "alert-a", status: "playing" }]);
  });

  it("survives a missing alert row", async () => {
    const db = {
      updateAlertLifecycle: async () => {
        throw new Error("not_found");
      },
    };

    await reportAlertsPlaying(db, fakeLogger(), [{ type: "alert", key: "alert-a" }]);
  });
});

describe("reportAlertsCompleted", () => {
  it("moves each finished alert's row to completed once, and ignores other events", async () => {
    const calls: Array<{ envelopeId: string; status: string }> = [];
    const db = {
      updateAlertLifecycle: async (req: { envelopeId: string; status: string; error: string }) => {
        calls.push({ envelopeId: req.envelopeId, status: req.status });
        return {};
      },
    };

    await reportAlertsCompleted(db, fakeLogger(), [
      { type: "alert", key: "alert-a" },
      { type: "alert", key: "alert-a" },
      { type: "widget.event", key: "count" },
    ]);

    expect(calls).toEqual([{ envelopeId: "alert-a", status: "completed" }]);
  });

  it("survives a missing alert row", async () => {
    const db = {
      updateAlertLifecycle: async () => {
        throw new Error("not_found");
      },
    };

    await reportAlertsCompleted(db, fakeLogger(), [{ type: "alert", key: "alert-a" }]);
  });
});
