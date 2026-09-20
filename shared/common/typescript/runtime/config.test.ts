import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fillEnvConfig, loadRuntimeEnv, screamingSnakeToCamel, camelToScreamingSnake } from "./config";

describe("Config loading from file and environment", () => {
  /**
   * Run `body` against a throwaway root holding `files`, with `vars` set in
   * process.env for its duration only.
   */
  function withConfigRoot(
    files: Record<string, string>,
    vars: Record<string, string>,
    body: (rootDir: string) => void
  ): void {
    const rootDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-runtime-config-"));
    const previous: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(vars)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(rootDir, name), content);
      }
      body(rootDir);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  }

  test("process.env overrides .env, which overrides .woofx3.json", () => {
    withConfigRoot(
      {
        ".woofx3.json": JSON.stringify({
          appName: "from-file",
          port: 3000,
          fromDotenv: "from-file",
          overwrite: "from-file",
        }),
        ".env": "WOOFX3_FROM_DOTENV=from-dotenv\nWOOFX3_OVERWRITE=from-dotenv",
      },
      { WOOFX3_OVERWRITE: "from-process" },
      (rootDir) => {
        const schema = z.object({
          woofx3AppName: z.string(),
          woofx3Port: z.number(),
          woofx3FromDotenv: z.string(),
          woofx3Overwrite: z.string(),
        });
        const result = loadRuntimeEnv({ rootDir, schema });
        expect(result.config.woofx3AppName).toBe("from-file");
        expect(result.config.woofx3Port).toBe(3000);
        expect(result.config.woofx3FromDotenv).toBe("from-dotenv");
        expect(result.getConfig("woofx3Overwrite")).toBe("from-process");
      }
    );
  });

  test("a blank value never masks a non-blank one from a lower-precedence source", () => {
    withConfigRoot(
      { ".woofx3.json": JSON.stringify({ blankInFile: "", blankInEnv: "from-file" }) },
      { WOOFX3_BLANK_IN_FILE: "from-process", WOOFX3_BLANK_IN_ENV: "" },
      (rootDir) => {
        const schema = z.object({ woofx3BlankInFile: z.string(), woofx3BlankInEnv: z.string() });
        const result = loadRuntimeEnv({ rootDir, schema });
        expect(result.config.woofx3BlankInFile).toBe("from-process");
        expect(result.config.woofx3BlankInEnv).toBe("from-file");
      }
    );
  });

  test("a key blank in every source still resolves, to blank", () => {
    withConfigRoot({ ".woofx3.json": JSON.stringify({ blankEverywhere: "" }) }, {}, (rootDir) => {
      const schema = z.object({ woofx3BlankEverywhere: z.string() });
      expect(loadRuntimeEnv({ rootDir, schema }).config.woofx3BlankEverywhere).toBe("");
    });
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
