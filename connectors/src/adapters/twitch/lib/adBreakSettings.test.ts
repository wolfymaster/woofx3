import { describe, expect, test } from "bun:test";
import type { SharedLogger } from "@woofx3/common/logging";
import {
  AdBreakLeadSetting,
  DEFAULT_AD_BREAK_LEAD_SECONDS,
  parseAdBreakLeadSeconds,
  TWITCH_MODULE_ID,
} from "./adBreakSettings";

function setting(settings: { key: string; value: string }[] | Error) {
  const warnings: Record<string, unknown>[] = [];
  const asked: string[] = [];
  const logger = {
    info() {},
    error() {},
    debug() {},
    warn: (_msg: string, meta: Record<string, unknown>) => warnings.push(meta),
  } as unknown as SharedLogger;
  const lead = new AdBreakLeadSetting(
    {
      listModuleSettings: async (moduleId) => {
        asked.push(moduleId);
        if (settings instanceof Error) {
          throw settings;
        }
        return settings;
      },
    },
    logger
  );
  return { lead, warnings, asked };
}

describe("parseAdBreakLeadSeconds", () => {
  test("reads positive whole seconds", () => {
    expect(parseAdBreakLeadSeconds("90")).toBe(90);
    expect(parseAdBreakLeadSeconds(" 120 ")).toBe(120);
  });

  test("rejects anything else", () => {
    for (const bad of ["", "0", "-30", "1.5", "abc", "60,30"]) {
      expect(parseAdBreakLeadSeconds(bad)).toBeNull();
    }
  });
});

describe("AdBreakLeadSetting", () => {
  test("reads the Twitch module's adBreakLeadSeconds", async () => {
    const { lead, asked } = setting([{ key: "adBreakLeadSeconds", value: "120" }]);

    expect(await lead.read()).toBe(120);
    expect(asked).toEqual([TWITCH_MODULE_ID]);
  });

  test("uses the default when the module or the setting is absent, or the value is empty", async () => {
    expect(await setting([]).lead.read()).toBe(DEFAULT_AD_BREAK_LEAD_SECONDS);
    expect(await setting([{ key: "adBreakLeadSeconds", value: "" }]).lead.read()).toBe(DEFAULT_AD_BREAK_LEAD_SECONDS);
  });

  test("uses the default when db-proxy cannot be read", async () => {
    expect(await setting(new Error("connection refused")).lead.read()).toBe(DEFAULT_AD_BREAK_LEAD_SECONDS);
  });

  test("uses the default for a bad value and warns once per value", async () => {
    const { lead, warnings } = setting([{ key: "adBreakLeadSeconds", value: "0" }]);

    expect(await lead.read()).toBe(DEFAULT_AD_BREAK_LEAD_SECONDS);
    expect(await lead.read()).toBe(DEFAULT_AD_BREAK_LEAD_SECONDS);

    expect(warnings).toEqual([{ value: "0", defaultSeconds: DEFAULT_AD_BREAK_LEAD_SECONDS }]);
  });
});
