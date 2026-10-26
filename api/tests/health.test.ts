import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES_SCHEMA, supportedEngineCapabilities } from "@woofx3/api";
import { describeHealth } from "../src/health";

const CAPABILITIES = { schema: 1, enabled: ["analytics.gauges", "analytics.sessionEvents"] };

describe("describeHealth", () => {
  test("reports the engine's name, region, release, start time, whole seconds of uptime and capabilities", () => {
    const health = describeHealth(
      {
        name: "eng-0a1b2c3d",
        region: "iad",
        version: "v0.6.2",
        startedAt: Date.UTC(2026, 9, 1, 12, 0, 0),
        capabilities: CAPABILITIES,
      },
      3725.9
    );

    expect(health).toEqual({
      status: "ok",
      name: "eng-0a1b2c3d",
      region: "iad",
      version: "v0.6.2",
      startedAt: "2026-10-01T12:00:00.000Z",
      uptimeSeconds: 3725,
      capabilities: { schema: 1, enabled: ["analytics.gauges", "analytics.sessionEvents"] },
    });
  });

  test("reports a null name and region for an engine nobody named or placed", () => {
    const health = describeHealth(
      { name: null, region: null, version: "dev", startedAt: 0, capabilities: CAPABILITIES },
      0
    );

    expect(health.name).toBeNull();
    expect(health.region).toBeNull();
  });

  test("lists the same capabilities getEngineCapabilities advertises", () => {
    const enabled = supportedEngineCapabilities();
    const health = describeHealth(
      {
        name: null,
        region: null,
        version: "dev",
        startedAt: 0,
        capabilities: { schema: ENGINE_CAPABILITIES_SCHEMA, enabled },
      },
      0
    );

    expect(health.capabilities).toEqual({ schema: ENGINE_CAPABILITIES_SCHEMA, enabled });
    expect(health.capabilities.enabled).toContain("analytics.sessionEvents");
  });
});
