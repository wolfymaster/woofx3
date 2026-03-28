import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  fillEnvConfig,
  loadRuntimeEnv,
  screamingSnakeToCamel,
  camelToScreamingSnake,
} from "./config";

describe("Config loading from file and environment", () => {
  test("loadRuntimeEnv merges process.env, .env file, and .woofx3.json with correct precedence", () => {
    const tmpDir = path.join(process.cwd(), "tmp-runtime-config-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.writeFileSync(
        path.join(tmpDir, ".env"),
        "FROM_DOTENV=dotenv_value\nWOOFX3_OVERWRITE=from_dotenv"
      );
      fs.writeFileSync(
        path.join(tmpDir, ".woofx3.json"),
        JSON.stringify({ appName: "from-woofx3", port: 3000, overwrite: "from_woofx3" })
      );
      const origOverwrite = process.env.WOOFX3_OVERWRITE;
      process.env.WOOFX3_OVERWRITE = "from_process";
      const schema = z.object({
        woofx3AppName: z.string(),
        woofx3Port: z.number(),
        woofx3Overwrite: z.string(),
      });
      try {
        const result = loadRuntimeEnv({ rootDir: tmpDir, schema });
        expect(result.config.woofx3AppName).toBe("from-woofx3");
        expect(result.config.woofx3Port).toBe(3000);
        expect(result.getConfig("woofx3Overwrite")).toBe("from_woofx3");
      } finally {
        if (origOverwrite !== undefined) {
          process.env.WOOFX3_OVERWRITE = origOverwrite;
        } else {
          delete process.env.WOOFX3_OVERWRITE;
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadRuntimeEnv with empty rootDir still includes process.env and produces config", () => {
    const schema = z.record(z.union([z.string(), z.number(), z.boolean()]));
    const result = loadRuntimeEnv({ rootDir: process.cwd(), schema });
    expect(result.config).toBeDefined();
    expect(result.getConfig).toBeDefined();
    expect(typeof result.getConfig("path")).toBe("string");
  });

  test("screamingSnakeToCamel and camelToScreamingSnake round-trip", () => {
    expect(screamingSnakeToCamel("WOOFX3_APP_NAME")).toBe("woofx3AppName");
    expect(camelToScreamingSnake("appName")).toBe("APP_NAME");
  });

  test("fillEnvConfig validates and types config from schema", () => {
    const schema = z.object({
      appName: z.string(),
      port: z.number(),
      enabled: z.boolean().optional(),
    });
    const config = { appName: "test", port: 8080, enabled: true };
    const parsed = fillEnvConfig(schema, config);
    expect(parsed.appName).toBe("test");
    expect(parsed.port).toBe(8080);
    expect(parsed.enabled).toBe(true);
  });

  test("fillEnvConfig throws on invalid config", () => {
    const schema = z.object({
      required: z.string(),
    });
    expect(() => fillEnvConfig(schema, {})).toThrow();
  });

  test("loadRuntimeEnv with schema returns config that matches schema exactly (no extra keys)", () => {
    const tmpDir = path.join(process.cwd(), "tmp-runtime-config-schema-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.writeFileSync(
        path.join(tmpDir, ".woofx3.json"),
        JSON.stringify({ appName: "myapp", port: 9000, extraKey: "should-be-stripped" })
      );
      const schema = z.object({
        woofx3AppName: z.string(),
        woofx3Port: z.number(),
      });
      const result = loadRuntimeEnv({ rootDir: tmpDir, schema });
      expect(result.config).toEqual({ woofx3AppName: "myapp", woofx3Port: 9000 });
      expect(Object.keys(result.config)).toHaveLength(2);
      expect(result.getConfig("woofx3AppName")).toBe("myapp");
      expect(result.getConfig("woofx3Port")).toBe(9000);
      expect(result.getConfig("woofx3ExtraKey")).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
