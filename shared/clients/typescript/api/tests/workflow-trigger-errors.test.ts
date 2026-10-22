import { describe, expect, test } from "bun:test";
import { TRIGGER_OPTIONS_NEED_DATA_MESSAGE, workflowNotFoundMessage } from "../workflow-trigger-errors";

describe("triggerWorkflowByName's refusals, as engines already shipped send them", () => {
  test("the options refusal never changes", () => {
    expect(TRIGGER_OPTIONS_NEED_DATA_MESSAGE).toBe(
      "options.platform and options.skipConditions only apply with options.triggerData"
    );
  });

  const notFound: { workflowNameOrId: string; message: string }[] = [
    { workflowNameOrId: "Follow alert", message: 'Workflow "Follow alert" not found' },
    { workflowNameOrId: "wf-2", message: 'Workflow "wf-2" not found' },
    { workflowNameOrId: "", message: 'Workflow "" not found' },
  ];

  for (const { workflowNameOrId, message } of notFound) {
    test(`the not-found message for ${JSON.stringify(workflowNameOrId)} never changes`, () => {
      expect(workflowNotFoundMessage(workflowNameOrId)).toBe(message);
    });
  }
});
