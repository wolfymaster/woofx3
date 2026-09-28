import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "../../src/workflow/validate-definition";

function withStep(action: string, parameters: Record<string, unknown>) {
  return {
    id: "raid-scene",
    name: "Raid scene",
    trigger: { type: "event" as const, event: "channel.raid" },
    tasks: [{ id: "t1", type: "action" as const, action, parameters }],
  };
}

function errorPaths(def: unknown): string[] {
  const r = validateWorkflowDefinition(def);
  return r.ok ? [] : r.errors.map((e) => e.path);
}

describe("obs.* action parameters", () => {
  test("accepts each action in its documented shape", () => {
    for (const def of [
      withStep("obs.switch_scene", { sceneName: "Raid" }),
      withStep("obs.set_source_visibility", { sourceName: "Confetti", visible: true }),
      withStep("obs.set_source_visibility", { sceneName: "Main", sourceName: "Confetti", visible: "false" }),
      withStep("obs.set_input_mute", { inputName: "Mic/Aux", muted: false }),
    ]) {
      expect(errorPaths(def)).toEqual([]);
    }
  });

  test("accepts expressions, whose type is only known at run time", () => {
    const def = withStep("obs.set_source_visibility", {
      sourceName: "${trigger.data.source}",
      visible: "${trigger.data.show}",
    });
    expect(errorPaths(def)).toEqual([]);
  });

  test("refuses a switch with no scene", () => {
    expect(errorPaths(withStep("obs.switch_scene", {}))).toEqual(["tasks[0].parameters.sceneName"]);
    expect(errorPaths(withStep("obs.switch_scene", { sceneName: "" }))).toEqual(["tasks[0].parameters.sceneName"]);
  });

  test("refuses a visibility step that does not say which source or which way", () => {
    expect(errorPaths(withStep("obs.set_source_visibility", { visible: "yes" }))).toEqual([
      "tasks[0].parameters.sourceName",
      "tasks[0].parameters.visible",
    ]);
  });

  test("refuses a scene name that is not a string", () => {
    const def = withStep("obs.set_source_visibility", { sceneName: 3, sourceName: "Confetti", visible: true });
    expect(errorPaths(def)).toEqual(["tasks[0].parameters.sceneName"]);
  });

  test("refuses a mute step with no input, and leaves the state to its default", () => {
    expect(errorPaths(withStep("obs.set_input_mute", {}))).toEqual(["tasks[0].parameters.inputName"]);
    expect(errorPaths(withStep("obs.set_input_mute", { inputName: "Mic/Aux" }))).toEqual([]);
  });

  test("leaves other actions' parameters alone", () => {
    expect(errorPaths(withStep("toString", {}))).toEqual([]);
    expect(errorPaths(withStep("print", {}))).toEqual([]);
  });
});
