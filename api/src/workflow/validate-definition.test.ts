import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "./validate-definition";

describe("validateWorkflowDefinition", () => {
  test("accepts a minimal valid definition", () => {
    const def = {
      id: "x",
      name: "X",
      trigger: { type: "event" as const, eventType: "cheer.user.twitch" },
      tasks: [{ id: "t1", type: "action" as const, parameters: { action: "print", message: "hi" } }],
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

  test("rejects task dependsOn referencing unknown id", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", eventType: "e" },
      tasks: [{ id: "t1", type: "action", dependsOn: ["ghost"], parameters: {} }],
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
      trigger: { type: "event", eventType: "e" },
      tasks: [
        { id: "t1", type: "action", parameters: {} },
        { id: "t1", type: "action", parameters: {} },
      ],
    });
    expect(r.ok).toBe(false);
  });

  test("rejects condition task with onTrue referencing unknown task", () => {
    const r = validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", eventType: "e" },
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
        eventType: "e",
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
      trigger: { type: "event", eventType: "e", conditions: [] },
      tasks: [{ id: "t1", type: "action", parameters: {} }],
    });
    expect(r.ok).toBe(true);
  });
});
