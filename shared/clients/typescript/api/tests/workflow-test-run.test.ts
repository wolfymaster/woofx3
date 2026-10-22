import { describe, expect, test } from "bun:test";
import {
  classifyOptionsProbe,
  OPTIONS_PROBE_WORKFLOW,
  TRIGGER_OPTIONS_NEED_DATA_MESSAGE,
  type TriggerOptionsSupport,
  workflowNotFoundMessage,
} from "../workflow-test-run";

describe("classifyOptionsProbe", () => {
  const cases: { name: string; rejection: unknown; support: TriggerOptionsSupport }[] = [
    { name: "an engine with options", rejection: new Error(TRIGGER_OPTIONS_NEED_DATA_MESSAGE), support: "supported" },
    {
      name: "an engine with options, as a message",
      rejection: TRIGGER_OPTIONS_NEED_DATA_MESSAGE,
      support: "supported",
    },
    {
      name: "an engine without options",
      rejection: new Error(workflowNotFoundMessage(OPTIONS_PROBE_WORKFLOW)),
      support: "unsupported",
    },
    {
      name: "another workflow not found",
      rejection: new Error(workflowNotFoundMessage("Follow alert")),
      support: "unknown",
    },
    { name: "the engine unreachable", rejection: new Error("fetch failed"), support: "unknown" },
    {
      name: "the method missing",
      rejection: new Error("'triggerWorkflowByName' is not a function."),
      support: "unknown",
    },
    { name: "a probe that resolved", rejection: undefined, support: "unknown" },
    { name: "an object with a message", rejection: { message: TRIGGER_OPTIONS_NEED_DATA_MESSAGE }, support: "unknown" },
  ];

  for (const { name, rejection, support } of cases) {
    test(`${name} -> ${support}`, () => {
      expect(classifyOptionsProbe(rejection)).toBe(support);
    });
  }
});

describe("the probe's wire text, as engines already shipped send it", () => {
  test("the options refusal never changes", () => {
    expect(TRIGGER_OPTIONS_NEED_DATA_MESSAGE).toBe(
      "options.platform and options.skipConditions only apply with options.triggerData"
    );
  });

  test("the not-found message never changes", () => {
    expect(workflowNotFoundMessage("Follow alert")).toBe('Workflow "Follow alert" not found');
  });

  const shipped: { name: string; rejection: Error; support: TriggerOptionsSupport }[] = [
    {
      name: "an engine with options",
      rejection: new Error("options.platform and options.skipConditions only apply with options.triggerData"),
      support: "supported",
    },
    {
      name: "an engine without options",
      rejection: new Error('Workflow "\u0000woofx3-options-probe" not found'),
      support: "unsupported",
    },
  ];

  for (const { name, rejection, support } of shipped) {
    test(`${name}, in its literal words -> ${support}`, () => {
      expect(classifyOptionsProbe(rejection)).toBe(support);
    });
  }
});
