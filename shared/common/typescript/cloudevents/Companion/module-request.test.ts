import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMPANION_GATEWAY_SUBJECTS,
  type CompanionGatewayParseResult,
  MODULE_ENDPOINT_FAILURE_CODES,
  parseModuleEndpointReply,
  parseModuleEndpointRequest,
} from "./module-request";

// The same cases barkloader's generated Rust is tested against
// (barkloader/lib_sandbox/tests/companion_gateway_contract.rs), so both
// languages accept and refuse the same messages.
const FIXTURE_DIR = join(import.meta.dir, "../../../contracts/testdata/companion-gateway");

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

function invalidAt<T>(result: CompanionGatewayParseResult<T>): string | null {
  return result.ok ? null : result.error.field;
}

describe("shared request fixtures", () => {
  for (const fixture of readFixtures("requests.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseModuleEndpointRequest(fixture.request))).toBe(fixture.invalidField);
    });
  }
});

describe("shared reply fixtures", () => {
  for (const fixture of readFixtures("replies.json")) {
    test(fixture.name, () => {
      expect(invalidAt(parseModuleEndpointReply(fixture.reply))).toBe(fixture.invalidField);
    });
  }
});

// The message bound is in UTF-8 bytes. Kept out of the fixtures, which would
// otherwise carry two 64 KiB strings; the Rust tests check the same lengths.
describe("message size", () => {
  const send = (message: string) => ({
    op: "send",
    moduleId: "vtube_studio",
    endpointId: "vts",
    message,
    budgetMs: 1000,
  });

  test("a message of exactly 65536 bytes is accepted", () => {
    expect(invalidAt(parseModuleEndpointRequest(send("é".repeat(32768))))).toBeNull();
  });

  test("a message one byte over is refused, though far under 65536 characters", () => {
    expect(invalidAt(parseModuleEndpointRequest(send(`${"é".repeat(32768)}x`)))).toBe("message");
  });

  test("a reply over 65536 bytes is refused", () => {
    const reply = { status: "ok", reply: "x".repeat(65537), sessionEpoch: "e-1" };
    expect(invalidAt(parseModuleEndpointReply(reply))).toBe("reply");
  });
});

describe("parsed values", () => {
  test("a request narrows on op", () => {
    const parsed = parseModuleEndpointRequest({
      op: "request",
      moduleId: "vtube_studio",
      endpointId: "vts",
      message: "{}",
      budgetMs: 4500,
      match: { field: "requestID", value: 7 },
    });
    if (!parsed.ok || parsed.value.op !== "request") {
      throw new Error(`expected a request, got ${JSON.stringify(parsed)}`);
    }
    expect(parsed.value.match).toEqual({ field: "requestID", value: 7 });
  });

  test("an empty or null optional field is left out", () => {
    expect(parseModuleEndpointReply({ status: "ok", reply: "", sessionEpoch: "e-1" })).toEqual({
      ok: true,
      value: { status: "ok", sessionEpoch: "e-1" },
    });
    expect(parseModuleEndpointReply({ status: "failed", code: "busy", message: "x", sessionEpoch: null })).toEqual({
      ok: true,
      value: { status: "failed", code: "busy", message: "x" },
    });
  });

  // JSON.parse yields the integer 1000 for `1000.0`, so TypeScript cannot tell
  // it from `1000`; barkloader's Rust refuses it (companion_gateway_contract.rs).
  test("an integral float reads as an integer", () => {
    const parsed = parseModuleEndpointRequest(
      JSON.parse('{"op":"send","moduleId":"vtube_studio","endpointId":"vts","message":"x","budgetMs":1000.0}')
    );
    expect(parsed.ok).toBe(true);
  });

  test("the subject and failure codes come from the contract", () => {
    expect(COMPANION_GATEWAY_SUBJECTS.moduleRequest).toBe("engine.companion.module.request");
    expect(MODULE_ENDPOINT_FAILURE_CODES).toContain("adapter_owned");
  });
});
