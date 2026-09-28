import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "../../src/workflow/validate-definition";

describe("validateWorkflowDefinition", () => {
  test("accepts a minimal valid definition", () => {
    const def = {
      id: "x",
      name: "X",
      trigger: { type: "event" as const, event: "channel.cheer" },
      tasks: [{ id: "t1", type: "action" as const, action: "print", parameters: { message: "hi" } }],
    };
    expect(validateWorkflowDefinition(def)).toEqual({ ok: true, value: def });
  });

  test("rejects missing trigger", () => {
    const r = validateWorkflowDefinition({ id: "x", name: "X", tasks: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].path).toBe("trigger");
    }
  });

  test("rejects action task with no action field", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", event: "e" },
      tasks: [{ id: "t1", type: "action", parameters: { message: "hi" } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "tasks[0].action")).toBe(true);
    }
  });

  test("rejects task dependsOn referencing unknown id", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", event: "e" },
      tasks: [{ id: "t1", type: "action", action: "print", dependsOn: ["ghost"], parameters: {} }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "tasks[0].dependsOn[0]")).toBe(true);
    }
  });

  test("rejects duplicate task ids", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", event: "e" },
      tasks: [
        { id: "t1", type: "action", action: "print", parameters: {} },
        { id: "t1", type: "action", action: "print", parameters: {} },
      ],
    });
    expect(r.ok).toBe(false);
  });

  test("rejects condition task with onTrue referencing unknown task", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", event: "e" },
      tasks: [
        {
          id: "c1",
          type: "condition",
          conditions: [{ field: "${trigger.data.x}", operator: "eq", value: 1 }],
          onTrue: ["missing"],
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  test("rejects unknown operator", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: {
        type: "event",
        event: "e",
        conditions: [{ field: "${trigger.data.x}", operator: "like" as never, value: 1 }],
      },
      tasks: [{ id: "t1", type: "action", parameters: {} }],
    });
    expect(r.ok).toBe(false);
  });

  test("accepts empty trigger conditions", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", event: "e", conditions: [] },
      tasks: [{ id: "t1", type: "action", action: "print", parameters: {} }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("schedule triggers", () => {
  test("accepts a valid cron expression", () => {
    const result = validateWorkflowDefinition({
      id: "wf-1",
      name: "Hourly",
      trigger: { type: "schedule", schedule: "0 * * * *" },
      tasks: [{ id: "t1", type: "log", parameters: { msg: "tick" } }],
    });
    expect(result.ok).toBe(true);
  });

  test("rejects a schedule trigger with empty schedule", () => {
    const result = validateWorkflowDefinition({
      id: "wf-1",
      name: "Broken",
      trigger: { type: "schedule", schedule: "" },
      tasks: [{ id: "t1", type: "log" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.includes("trigger.schedule"))).toBe(true);
    }
  });

  test("rejects a schedule trigger with malformed cron", () => {
    const result = validateWorkflowDefinition({
      id: "wf-1",
      name: "Broken",
      trigger: { type: "schedule", schedule: "not-a-cron" },
      tasks: [{ id: "t1", type: "log" }],
    });
    expect(result.ok).toBe(false);
  });

  describe("wait tasks", () => {
    const withWait = (wait: unknown) =>
      validateWorkflowDefinition({
        id: "x",
        name: "X",
        trigger: { type: "event", event: "channel.raid" },
        tasks: [{ id: "pause", type: "wait", wait }],
      });
    const paths = (r: ReturnType<typeof validateWorkflowDefinition>) => (r.ok ? [] : r.errors.map((e) => e.path));

    test("accepts a delay", () => {
      expect(withWait({ type: "delay", durationMs: 10_000 }).ok).toBe(true);
    });

    test("accepts an event wait with a timeout", () => {
      expect(withWait({ type: "event", event: "channel.follow", timeout: "30s", onTimeout: "continue" }).ok).toBe(true);
    });

    test("rejects a delay out of bounds", () => {
      expect(paths(withWait({ type: "delay", durationMs: 0 }))).toEqual(["tasks[0].wait.durationMs"]);
      expect(paths(withWait({ type: "delay", durationMs: 24 * 60 * 60 * 1000 + 1 }))).toEqual([
        "tasks[0].wait.durationMs",
      ]);
      expect(paths(withWait({ type: "delay", durationMs: 1.5 }))).toEqual(["tasks[0].wait.durationMs"]);
    });

    test("rejects event fields on a delay", () => {
      expect(paths(withWait({ type: "delay", durationMs: 100, event: "e", timeout: "1s" }))).toEqual([
        "tasks[0].wait.event",
        "tasks[0].wait.timeout",
      ]);
    });

    test("rejects an event wait without an event", () => {
      expect(paths(withWait({ type: "event" }))).toEqual(["tasks[0].wait.event"]);
    });

    test("rejects a wait task without a wait config", () => {
      expect(paths(withWait(undefined))).toEqual(["tasks[0].wait"]);
    });
  });
});
