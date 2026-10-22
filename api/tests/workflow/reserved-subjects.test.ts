import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedEventTypeProblem, RESERVED_SUBJECT_PREFIXES } from "../../src/workflow/reserved-subjects";
import { validateWorkflowDefinition } from "../../src/workflow/validate-definition";

const CONTRACT = join(import.meta.dir, "../../../shared/common/contracts/reserved-subjects.json");

/** One list of the contract, read from disk rather than through the import the module under test uses. */
function contractList(name: string): string[] {
  const contract: unknown = JSON.parse(readFileSync(CONTRACT, "utf8"));
  if (typeof contract !== "object" || contract === null || !(name in contract)) {
    throw new Error(`reserved-subjects.json declares no ${name}`);
  }
  const list: unknown = (contract as Record<string, unknown>)[name];
  if (!Array.isArray(list) || !list.every((e) => typeof e === "string")) {
    throw new Error(`reserved-subjects.json ${name} is not a list of strings`);
  }
  return list;
}

describe("reserved subjects", () => {
  test("are the contract's command and engine-asserted lists", () => {
    const engine = [...contractList("commandSubjectPrefixes"), ...contractList("engineAssertedPrefixes")];
    expect([...RESERVED_SUBJECT_PREFIXES].sort()).toEqual(engine.sort());
  });

  test("point every platform event entry at simulateTwitchEvent", () => {
    for (const entry of contractList("platformEventEntries")) {
      const subject = entry.endsWith(".") ? `${entry}x` : entry;
      expect(publishedEventTypeProblem(subject)).toContain("simulateTwitchEvent");
    }
  });

  test("name the prefix a subject falls under", () => {
    expect(publishedEventTypeProblem("widget.queue.clear")).toBe('is reserved for the engine ("widget.queue.")');
    expect(publishedEventTypeProblem("workflow.cancel")).toBe('is reserved for the engine ("workflow.cancel")');
    expect(publishedEventTypeProblem("channel.cheer")).toContain("simulateTwitchEvent");
    expect(publishedEventTypeProblem("custom.*")).toContain("wildcard");
    expect(publishedEventTypeProblem("custom.\u00a0event")).toContain("whitespace");
    expect(publishedEventTypeProblem("custom.\u0007event")).toContain("control character");
    expect(publishedEventTypeProblem("message.send")).not.toBeNull();
    expect(publishedEventTypeProblem("command.created")).toBe('is reserved for the engine ("command.")');
    expect(publishedEventTypeProblem("message.sent")).toBeNull();
    expect(publishedEventTypeProblem("badge.awarded")).toBeNull();
    expect(publishedEventTypeProblem("stream.started.notification")).toBeNull();
  });
});

describe("validateWorkflowDefinition publish_event", () => {
  function publishing(eventType: string) {
    return validateWorkflowDefinition({
      id: "x",
      name: "X",
      trigger: { type: "event", event: "e" },
      tasks: [{ id: "t1", type: "action", action: "publish_event", parameters: { eventType } }],
    });
  }

  test("refuses a reserved subject at save time", () => {
    const r = publishing("ui.notify.alert");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        {
          path: "tasks[0].parameters.eventType",
          message: '"ui.notify.alert" is reserved for the engine ("ui.notify.")',
        },
      ]);
    }
  });

  test("accepts an event of the workflow's own, and leaves an expression to the engine", () => {
    expect(publishing("badge.awarded").ok).toBe(true);
    expect(publishing("${trigger.data.kind}").ok).toBe(true);
  });
});
