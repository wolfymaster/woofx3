import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ChatPinPayload,
  EgressActionId,
  type GatewayParseResult,
  type GatewayRequest,
  PLATFORM_DISPLAY_NAMES,
  PLATFORM_IDS,
  type PlatformCapability,
  type PlatformResults,
  parseCapabilitiesReply,
  parseFieldOptionsReply,
  parseFieldOptionsRequest,
  parseGatewayReply,
  parseGatewayRequest,
  parsePayload,
  replyOk,
  type Target,
} from "@woofx3/api/platform-gateway";

// The same cases the Go validators are tested against
// (shared/common/golang/platformgateway/catalog_test.go), so both languages
// accept and refuse the same requests and replies, at the same field.
const FIXTURE_DIR = join(import.meta.dir, "../../shared/common/contracts/testdata/platform-gateway");

interface Fixture {
  name: string;
  invalidField: string | null;
  request?: unknown;
  reply?: unknown;
}

function readFixtures(name: string): Fixture[] {
  const file: { cases: Fixture[] } = JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
  expect(file.cases.length).toBeGreaterThan(0);
  return file.cases;
}

function invalidAt<T>(result: GatewayParseResult<T>): string | null {
  return result.ok ? null : result.error.field;
}

describe("shared request fixtures", () => {
  for (const fixture of readFixtures("requests.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseGatewayRequest(fixture.request))).toBe(fixture.invalidField);
    });
  }
});

describe("shared reply fixtures", () => {
  for (const fixture of readFixtures("replies.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseGatewayReply(fixture.reply))).toBe(fixture.invalidField);
    });
  }
});

describe("shared capabilities reply fixtures", () => {
  for (const fixture of readFixtures("capabilities-replies.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseCapabilitiesReply(fixture.reply))).toBe(fixture.invalidField);
    });
  }
});

describe("shared field-options request fixtures", () => {
  for (const fixture of readFixtures("field-options-requests.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseFieldOptionsRequest(fixture.request))).toBe(fixture.invalidField);
    });
  }
});

describe("shared field-options reply fixtures", () => {
  for (const fixture of readFixtures("field-options-replies.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseFieldOptionsReply(fixture.reply))).toBe(fixture.invalidField);
    });
  }
});

const VALID_REQUEST = {
  action: "chat.send",
  target: { kind: "all" },
  payload: { message: "hello chat" },
  idempotencyKey: "exec-1:task-1",
  requestedBy: { kind: "workflow", ref: "workflow-1" },
};

describe("parseGatewayRequest", () => {
  test.each([
    ["an unknown top-level key", { ...VALID_REQUEST, idempotencykey: "x" }, "idempotencykey"],
    [
      "an unknown requestedBy key",
      { ...VALID_REQUEST, requestedBy: { kind: "api", ref: "c", user: "x" } },
      "requestedBy.user",
    ],
    [
      "an unknown origin key",
      { ...VALID_REQUEST, target: { kind: "origin", origin: { platform: "twitch", x: 1 } } },
      "target.origin.x",
    ],
    ["ids that are not an array", { ...VALID_REQUEST, target: { kind: "platforms", ids: "twitch" } }, "target.ids"],
    ["a workflowChain that is not a string", { ...VALID_REQUEST, workflowChain: ["a"] }, "workflowChain"],
    ["options that are not an object", { ...VALID_REQUEST, options: [] }, "options"],
    ["a request that is not an object", "chat.send", "request"],
  ])("refuses %s", (_name, request, field) => {
    expect(invalidAt(parseGatewayRequest(request))).toBe(field);
  });

  test("keeps only what the contract declares, dropping empty optionals", () => {
    const result = parseGatewayRequest({
      ...VALID_REQUEST,
      payload: { message: "hi", replyToMessageId: "" },
      workflowChain: "workflow-a,workflow-b",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        action: "chat.send",
        target: { kind: "all" },
        payload: { message: "hi" },
        idempotencyKey: "exec-1:task-1",
        requestedBy: { kind: "workflow", ref: "workflow-1" },
        workflowChain: "workflow-a,workflow-b",
      },
    });
    expect(result.ok && "replyToMessageId" in result.value.payload).toBe(false);
  });

  test("narrows the payload by action", () => {
    const result = parseGatewayRequest({ ...VALID_REQUEST, action: "chat.pin", payload: { messageId: "msg-1" } });
    if (!result.ok) {
      throw new Error(result.error.problem);
    }
    const request: GatewayRequest = result.value;
    if (request.action !== EgressActionId.CHAT_PIN) {
      throw new Error(`unexpected action ${request.action}`);
    }
    const payload: ChatPinPayload = request.payload;
    expect("messageId" in payload ? payload.messageId : payload.message).toBe("msg-1");
  });
});

describe("parsePayload", () => {
  test("picks the chat.pin variant from its fields", () => {
    expect(parsePayload("chat.pin", { message: "pinned", durationSeconds: 60 })).toEqual({
      ok: true,
      value: { message: "pinned", durationSeconds: 60 },
    });
    expect(parsePayload("chat.pin", { messageId: "msg-1" })).toEqual({ ok: true, value: { messageId: "msg-1" } });
  });

  test("refuses an action outside the catalog instead of throwing", () => {
    const result = parsePayload("chat.shout" as never, { message: "hi" });
    expect(result).toEqual({ ok: false, error: { field: "action", problem: 'unknown action "chat.shout"' } });
  });
});

describe("parseGatewayReply", () => {
  test("drops fields that belong to another status", () => {
    expect(parseGatewayReply({ ok: true, results: { twitch: { status: "delivered", reason: "stray" } } })).toEqual({
      ok: true,
      value: { ok: true, results: { twitch: { status: "delivered" } } },
    });
  });

  test("refuses an ok that is not a boolean", () => {
    expect(invalidAt(parseGatewayReply({ ok: "yes", results: {} }))).toBe("ok");
  });
});

// Wrong JSON types fail to decode in Go before validation runs, so these
// cases cannot live in the shared fixtures.
describe("discovery parsers refuse wrong JSON types", () => {
  const capability: PlatformCapability = {
    id: "twitch",
    displayName: "Twitch",
    state: "connected",
    connected: true,
    enabled: true,
    actions: [],
  };

  test.each<[string, GatewayParseResult<unknown>, string]>([
    ["a capabilities reply that is not an object", parseCapabilitiesReply([]), "reply"],
    ["platforms that are not an array", parseCapabilitiesReply({ platforms: {} }), "platforms"],
    ["an error that is not a string", parseCapabilitiesReply({ error: 1 }), "error"],
    [
      "a missing connected",
      parseCapabilitiesReply({ platforms: [{ ...capability, connected: undefined }] }),
      "platforms[0].connected",
    ],
    [
      "an enabled that is not a boolean",
      parseCapabilitiesReply({ platforms: [{ ...capability, enabled: "yes" }] }),
      "platforms[0].enabled",
    ],
    [
      "actions that are not an array",
      parseCapabilitiesReply({ platforms: [{ ...capability, actions: "chat.send" }] }),
      "platforms[0].actions",
    ],
    ["a field-options request that is not an object", parseFieldOptionsRequest("chat.send"), "request"],
    ["a non-string action", parseFieldOptionsRequest({ action: 3 }), "action"],
    ["an option that is not an object", parseFieldOptionsReply(["twitch"]), "[0]"],
  ])("refuses %s", (_name, result, field) => {
    expect(invalidAt(result)).toBe(field);
  });

  test("keeps only what the contract declares", () => {
    expect(parseCapabilitiesReply({ platforms: [{ ...capability, extra: 1 }], at: 2 })).toEqual({
      ok: true,
      value: { platforms: [capability] },
    });
    expect(parseFieldOptionsRequest({ action: "chat.pin", fieldId: "platform" })).toEqual({
      ok: true,
      value: { action: "chat.pin" },
    });
  });
});

describe("replyOk", () => {
  const twitch: Target = { kind: "platforms", ids: ["twitch"] };
  const origin: Target = { kind: "origin", origin: { platform: "twitch", messageId: "msg-1" } };
  const all: Target = { kind: "all" };
  const delivered: PlatformResults = { twitch: { status: "delivered", messageId: "msg-2" } };
  const unsupported: PlatformResults = { twitch: { status: "unsupported" } };
  const unconfirmed: PlatformResults = { twitch: { status: "unconfirmed", message: "no answer in time" } };

  test.each([
    ["named platform delivered", twitch, delivered, true],
    ["named platform unconfirmed", twitch, unconfirmed, false],
    ["named platform missing from results", twitch, {}, false],
    ["origin delivered", origin, delivered, true],
    ["origin unsupported", origin, unsupported, false],
    ["all with one delivered", all, delivered, true],
    ["all with only unsupported", all, unsupported, false],
    ["all with no platform resolved", all, {}, false],
  ] as const)("%s", (_name, target, results, want) => {
    expect(replyOk(target, results)).toBe(want);
  });
});

test("every platform has a display name", () => {
  for (const id of PLATFORM_IDS) {
    expect(PLATFORM_DISPLAY_NAMES[id]).toBeTruthy();
  }
});
