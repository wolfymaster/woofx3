import { describe, expect, test } from "bun:test";
import {
  INTEGRATION_IDS,
  type IntegrationEnabled,
  integrationEnabledSettingKey,
  isIntegrationId,
  parseIntegrationEnabled,
  resolveEnabled,
} from "./integration-settings";

describe("parseIntegrationEnabled", () => {
  const cases: [string | null, IntegrationEnabled][] = [
    ["true", { kind: "set", enabled: true }],
    ["false", { kind: "set", enabled: false }],
    ["", { kind: "absent" }],
    [null, { kind: "absent" }],
    ["TRUE", { kind: "invalid", raw: "TRUE" }],
    ["1", { kind: "invalid", raw: "1" }],
    ["yes", { kind: "invalid", raw: "yes" }],
  ];
  test.each(cases)("%p", (raw, want) => {
    expect(parseIntegrationEnabled(raw)).toEqual(want);
  });
});

describe("resolveEnabled", () => {
  const cases: [string, IntegrationEnabled, boolean, boolean][] = [
    ["set true, connected", { kind: "set", enabled: true }, true, true],
    ["set true, not connected", { kind: "set", enabled: true }, false, true],
    ["set false, connected", { kind: "set", enabled: false }, true, false],
    ["set false, not connected", { kind: "set", enabled: false }, false, false],
    ["absent, connected", { kind: "absent" }, true, true],
    ["absent, not connected", { kind: "absent" }, false, false],
    ["invalid, connected", { kind: "invalid", raw: "yes" }, true, true],
    ["invalid, not connected", { kind: "invalid", raw: "yes" }, false, false],
  ];
  test.each(cases)("%s", (_name, parsed, connected, want) => {
    expect(resolveEnabled(parsed, connected)).toBe(want);
  });
});

describe("registry", () => {
  test("setting key is per integration", () => {
    expect(integrationEnabledSettingKey("twitch")).toBe("integration.twitch.enabled");
  });
  test("isIntegrationId accepts only registered ids", () => {
    expect(INTEGRATION_IDS.every((id) => isIntegrationId(id))).toBe(true);
    expect(isIntegrationId("obs")).toBe(false);
    expect(isIntegrationId(undefined)).toBe(false);
  });
});
