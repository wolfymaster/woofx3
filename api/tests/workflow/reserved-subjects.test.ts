import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedEventTypeProblem, RESERVED_SUBJECT_PREFIXES } from "../../src/workflow/reserved-subjects";
import { validateWorkflowDefinition } from "../../src/workflow/validate-definition";

const GO_RESERVED = join(import.meta.dir, "../../../shared/common/golang/cloudevents/reserved.go");

/** The string entries of one `var Name = []string{...}` block in reserved.go. */
function goList(source: string, name: string): string[] {
  const block = new RegExp(`var ${name} = \\[\\]string\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!block) {
    throw new Error(`reserved.go declares no ${name}`);
  }
  return [...block[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
}

describe("reserved subjects", () => {
  test("match the engine's list", () => {
    const source = readFileSync(GO_RESERVED, "utf8");
    const engine = [...goList(source, "CommandSubjectPrefixes"), ...goList(source, "EngineEventSubjectPrefixes")];
    expect([...RESERVED_SUBJECT_PREFIXES].sort()).toEqual(engine.sort());
  });

  test("name the prefix a subject falls under", () => {
    expect(publishedEventTypeProblem("widget.queue.clear")).toBe('is reserved for the engine (prefix "widget.queue.")');
    expect(publishedEventTypeProblem("custom.*")).toContain("wildcard");
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
          message: '"ui.notify.alert" is reserved for the engine (prefix "ui.notify.")',
        },
      ]);
    }
  });

  test("accepts an event of the workflow's own, and leaves an expression to the engine", () => {
    expect(publishing("badge.awarded").ok).toBe(true);
    expect(publishing("${trigger.data.kind}").ok).toBe(true);
  });
});
