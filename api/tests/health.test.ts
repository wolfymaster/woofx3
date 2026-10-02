import { describe, expect, test } from "bun:test";
import { describeHealth } from "../src/health";

describe("describeHealth", () => {
  test("reports the engine's name, release, start time and whole seconds of uptime", () => {
    const health = describeHealth(
      { name: "eng-0a1b2c3d", version: "v0.6.2", startedAt: Date.UTC(2026, 9, 1, 12, 0, 0) },
      3725.9
    );

    expect(health).toEqual({
      status: "ok",
      name: "eng-0a1b2c3d",
      version: "v0.6.2",
      startedAt: "2026-10-01T12:00:00.000Z",
      uptimeSeconds: 3725,
    });
  });

  test("reports a null name for an engine nobody named", () => {
    expect(describeHealth({ name: null, version: "dev", startedAt: 0 }, 0).name).toBeNull();
  });
});
