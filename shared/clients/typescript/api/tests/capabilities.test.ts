import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES_SCHEMA, parseEngineCapabilities, supportedEngineCapabilities } from "../capabilities";

describe("parseEngineCapabilities", () => {
  const readable: { name: string; raw: unknown; capabilities: string[] }[] = [
    { name: "an empty list", raw: { schema: 1, capabilities: [] }, capabilities: [] },
    {
      name: "a sorted list",
      raw: { schema: 1, capabilities: ["alerts.history", "obs.status"] },
      capabilities: ["alerts.history", "obs.status"],
    },
    {
      name: "an unsorted list with duplicates",
      raw: { schema: 1, capabilities: ["obs.status", "alerts.history", "obs.status"] },
      capabilities: ["alerts.history", "obs.status"],
    },
    {
      name: "ids this contract does not declare",
      raw: { schema: 1, capabilities: ["future.feature", "obs.status"] },
      capabilities: ["future.feature", "obs.status"],
    },
    {
      name: "entries that are not ids",
      raw: { schema: 1, capabilities: ["obs.status", 7, null, "", { id: "x" }] },
      capabilities: ["obs.status"],
    },
    {
      name: "extra fields beside the list",
      raw: { schema: 1, capabilities: ["obs.status"], note: "ignored" },
      capabilities: ["obs.status"],
    },
  ];

  for (const { name, raw, capabilities } of readable) {
    test(`reads ${name}`, () => {
      expect(parseEngineCapabilities(raw)).toEqual({ schema: ENGINE_CAPABILITIES_SCHEMA, capabilities });
    });
  }

  const unreadable: { name: string; raw: unknown; message: RegExp }[] = [
    { name: "nothing", raw: undefined, message: /answered getEngineCapabilities with undefined/ },
    { name: "null", raw: null, message: /answered getEngineCapabilities with null/ },
    { name: "a bare list", raw: ["obs.status"], message: /answered getEngineCapabilities with \["obs.status"\]/ },
    { name: "a string", raw: "obs.status", message: /answered getEngineCapabilities with "obs.status"/ },
    { name: "no schema", raw: { capabilities: [] }, message: /schema undefined; this client reads schema 1/ },
    { name: "a newer schema", raw: { schema: 2, capabilities: [] }, message: /schema 2; this client reads schema 1/ },
    { name: "the schema as text", raw: { schema: "1", capabilities: [] }, message: /schema "1"/ },
    { name: "no list", raw: { schema: 1 }, message: /without a capabilities list/ },
    {
      name: "a list that is not one",
      raw: { schema: 1, capabilities: "obs.status" },
      message: /without a capabilities list/,
    },
  ];

  for (const { name, raw, message } of unreadable) {
    test(`refuses ${name}`, () => {
      expect(() => parseEngineCapabilities(raw)).toThrow(message);
    });
  }

  test("reads back exactly what this engine build advertises", () => {
    for (const hosting of [null, "managed", "self", "local"] as const) {
      const capabilities = supportedEngineCapabilities(hosting);
      expect(parseEngineCapabilities({ schema: ENGINE_CAPABILITIES_SCHEMA, capabilities }).capabilities).toEqual(
        capabilities
      );
    }
  });
});
