import { describe, expect, it } from "bun:test";
import { EngineEventType } from "@woofx3/api/webhooks";
import { parseCommandCreated, parseCommandDeleted, parseCommandUpdated } from "../src/command-event-handlers";

const COMMAND_ID = "33333333-3333-3333-3333-333333333333";

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: COMMAND_ID,
      command: "sr",
      actions_json: '[{"id":"action-1","action":"function","function":"spotify:function:song_request"}]',
      cooldown: 30,
      priority: 1,
      enabled: true,
      visibility: "public",
      group_ids: ["g1"],
      usernames: ["someone"],
      argument_pattern: "{query}",
      created_by_type: "MODULE",
      created_by_ref: "spotify",
      ...overrides,
    },
  };
}

describe("parseCommandCreated", () => {
  it("decodes the row from buildCommandChangeData", () => {
    const event = parseCommandCreated(commandRow());
    expect(event?.type).toBe(EngineEventType.COMMAND_CREATED);
    expect(event?.command).toEqual({
      id: COMMAND_ID,
      command: "sr",
      actions: [{ id: "action-1", action: "function", function: "spotify:function:song_request" }],
      cooldown: 30,
      priority: 1,
      enabled: true,
      visibility: "public",
      groupIds: ["g1"],
      usernames: ["someone"],
      argumentPattern: "{query}",
    });
  });

  it("drops a row without an id", () => {
    expect(parseCommandCreated(commandRow({ id: undefined }))).toBeNull();
  });

  it("treats anything but public as restricted", () => {
    expect(parseCommandCreated(commandRow({ visibility: "" }))?.command.visibility).toBe("restricted");
  });
});

describe("parseCommandUpdated", () => {
  it("carries the updated snapshot", () => {
    const event = parseCommandUpdated(commandRow({ enabled: false }));
    expect(event?.type).toBe(EngineEventType.COMMAND_UPDATED);
    expect(event?.command.enabled).toBe(false);
  });
});

describe("parseCommandDeleted", () => {
  it("reports the deleted id", () => {
    const event = parseCommandDeleted({ data: { id: COMMAND_ID, command: "sr" } });
    expect(event).toEqual({ type: EngineEventType.COMMAND_DELETED, commandId: COMMAND_ID });
  });

  it("drops a row without an id", () => {
    expect(parseCommandDeleted({ data: { command: "sr" } })).toBeNull();
  });
});
