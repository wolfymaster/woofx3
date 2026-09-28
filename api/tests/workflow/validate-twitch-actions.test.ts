import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "../../src/workflow/validate-definition";

function withStep(action: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: "wf",
    name: "WF",
    trigger: { type: "event" as const, event: "channel.raid" },
    tasks: [{ id: "t1", type: "action" as const, action, parameters, ...extra }],
  };
}

function errorsOf(action: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const result = validateWorkflowDefinition(withStep(action, parameters, extra));
  return result.ok ? [] : result.errors;
}

describe("twitch.* action parameters", () => {
  test.each([
    ["twitch.shoutout", { userId: "${trigger.data.fromBroadcasterUserId}", skipIfRateLimited: true }],
    ["twitch.shoutout", { userName: "@raider" }],
    ["twitch.clip", {}],
    ["twitch.marker", {}],
    ["twitch.marker", { description: "hype" }],
    ["twitch.update_stream", { title: "BRB ${trigger.data.argsText}" }],
    ["twitch.update_stream", { category: "Just Chatting", title: "" }],
    ["twitch.update_stream", { tags: "English, हिन्दी" }],
    ["twitch.update_stream", { tags: ["English", "Chill"] }],
    ["twitch.timeout", { userId: "${trigger.data.chatterId}", durationSeconds: 600 }],
    ["twitch.timeout", { userName: "x", durationSeconds: "${trigger.data.seconds}" }],
    ["twitch.timeout", { userName: "x", durationSeconds: "60", reason: "r".repeat(500) }],
  ])("accepts %s %j", (action, parameters) => {
    expect(errorsOf(action, parameters)).toEqual([]);
  });

  test.each([
    ["twitch.shoutout", {}, "tasks[0].parameters.userName", "userName or userId is required"],
    ["twitch.shoutout", { userId: "1", skipIfRateLimited: "maybe" }, "tasks[0].parameters.skipIfRateLimited", "true or false"],
    ["twitch.marker", { description: "d".repeat(141) }, "tasks[0].parameters.description", "at most 140"],
    ["twitch.update_stream", { title: "", category: "  " }, "tasks[0].parameters", "set at least one"],
    ["twitch.update_stream", { title: "t".repeat(141) }, "tasks[0].parameters.title", "at most 140"],
    ["twitch.update_stream", { tags: "chill vibes" }, "tasks[0].parameters.tags", "letters and numbers"],
    ["twitch.update_stream", { tags: "a,b,c,d,e,f,g,h,i,j,k" }, "tasks[0].parameters.tags", "at most 10"],
    ["twitch.update_stream", { tags: "Chill,chill" }, "tasks[0].parameters.tags", "listed twice"],
    ["twitch.timeout", { userName: "x" }, "tasks[0].parameters.durationSeconds", "required"],
    ["twitch.timeout", { userName: "x", durationSeconds: 0 }, "tasks[0].parameters.durationSeconds", "from 1 to 1209600"],
    ["twitch.timeout", { userName: "x", durationSeconds: 1.5 }, "tasks[0].parameters.durationSeconds", "whole number"],
    ["twitch.timeout", { userName: "x", durationSeconds: 60, reason: "r".repeat(501) }, "tasks[0].parameters.reason", "at most 500"],
  ])("refuses %s %j", (action, parameters, path, message) => {
    const errors = errorsOf(action, parameters);
    expect(errors.some((e) => e.path === path && e.message.includes(message))).toBe(true);
  });

  test("does not check a disabled step", () => {
    expect(errorsOf("twitch.timeout", {}, { disabled: true })).toEqual([]);
  });
});
