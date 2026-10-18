import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CONFIG_FILE_ENV,
  camelToScreamingSnake,
  fillEnvConfig,
  findProjectRoot,
  loadRuntimeEnv,
  ROOT_DIR_ENV,
  resolveConfigLocation,
  screamingSnakeToCamel,
} from "./config";

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

describe("Config location", () => {
  const passthrough = { parse: (config: Record<string, string | number | boolean>) => config };

  /** Run `body` with WOOFX3_ROOT and WOOFX3_CONFIG set to `vars` (absent means unset), restoring both after. */
  function withLocationEnv(vars: { root?: string; config?: string }, body: () => void): void {
    const previous = { root: process.env[ROOT_DIR_ENV], config: process.env[CONFIG_FILE_ENV] };
    const assign = (name: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    assign(ROOT_DIR_ENV, vars.root);
    assign(CONFIG_FILE_ENV, vars.config);
    try {
      body();
    } finally {
      assign(ROOT_DIR_ENV, previous.root);
      assign(CONFIG_FILE_ENV, previous.config);
    }
  }

  function tempDir(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-runtime-location-"));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  test("an explicit rootDir ignores WOOFX3_ROOT and WOOFX3_CONFIG", () => {
    const location = resolveConfigLocation("/srv/explicit", {
      [ROOT_DIR_ENV]: "/srv/root",
      [CONFIG_FILE_ENV]: "/srv/config/engine.json",
    });
    expect(location).toEqual({ rootDir: path.resolve("/srv/explicit") });
  });

  test("WOOFX3_CONFIG names the file, with .env from its directory", () => {
    const location = resolveConfigLocation(undefined, { [CONFIG_FILE_ENV]: "/srv/config/engine.json" });
    expect(location).toEqual({
      rootDir: path.resolve("/srv/config"),
      configPath: path.resolve("/srv/config/engine.json"),
    });
  });

  test("WOOFX3_CONFIG names the file and WOOFX3_ROOT the directory holding .env", () => {
    const location = resolveConfigLocation(undefined, {
      [ROOT_DIR_ENV]: "/srv/root",
      [CONFIG_FILE_ENV]: "/srv/config/engine.json",
    });
    expect(location).toEqual({
      rootDir: path.resolve("/srv/root"),
      configPath: path.resolve("/srv/config/engine.json"),
    });
  });

  test("WOOFX3_ROOT names the root", () => {
    expect(resolveConfigLocation(undefined, { [ROOT_DIR_ENV]: "/srv/root" })).toEqual({
      rootDir: path.resolve("/srv/root"),
    });
  });

  test("with neither variable the root is found above the working directory", () => {
    expect(resolveConfigLocation(undefined, {})).toEqual({ rootDir: findProjectRoot() });
    expect(resolveConfigLocation(undefined, { [ROOT_DIR_ENV]: "", [CONFIG_FILE_ENV]: "" })).toEqual({
      rootDir: findProjectRoot(),
    });
  });

  test("the variables are trimmed and blank counts as unset", () => {
    expect(resolveConfigLocation(undefined, { [ROOT_DIR_ENV]: " /srv/root\n", [CONFIG_FILE_ENV]: "  " })).toEqual({
      rootDir: path.resolve("/srv/root"),
    });
    expect(resolveConfigLocation(undefined, { [CONFIG_FILE_ENV]: "\t/srv/config/engine.json " })).toEqual({
      rootDir: path.resolve("/srv/config"),
      configPath: path.resolve("/srv/config/engine.json"),
    });
  });

  test("a blank explicit rootDir counts as unset, as in Go", () => {
    expect(resolveConfigLocation("", { [ROOT_DIR_ENV]: "/srv/root" })).toEqual({ rootDir: path.resolve("/srv/root") });
  });

  test("loadRuntimeEnv reads the config and .env under WOOFX3_ROOT", () => {
    const root = tempDir({
      ".woofx3.json": JSON.stringify({ locationRootFile: "from-root" }),
      ".env": "WOOFX3_LOCATION_ROOT_DOTENV=from-root\n",
    });
    try {
      withLocationEnv({ root }, () => {
        const { config } = loadRuntimeEnv({ schema: passthrough });
        expect(config.woofx3LocationRootFile).toBe("from-root");
        expect(config.woofx3LocationRootDotenv).toBe("from-root");
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("loadRuntimeEnv reads the file WOOFX3_CONFIG names", () => {
    const dir = tempDir({
      "engine.json": JSON.stringify({ locationConfigFile: "from-named-file" }),
      ".env": "WOOFX3_LOCATION_CONFIG_DOTENV=from-file-dir\n",
    });
    try {
      withLocationEnv({ config: path.join(dir, "engine.json") }, () => {
        const { config } = loadRuntimeEnv({ schema: passthrough });
        expect(config.woofx3LocationConfigFile).toBe("from-named-file");
        expect(config.woofx3LocationConfigDotenv).toBe("from-file-dir");
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const unreadableConfigs = [
    { name: "malformed JSON", content: "{not json" },
    { name: "a JSON array", content: "[1, 2]" },
    { name: "a JSON scalar", content: "42" },
    { name: "JSON null", content: "null" },
  ];

  for (const { name, content } of unreadableConfigs) {
    test(`loadRuntimeEnv refuses a WOOFX3_CONFIG file holding ${name}`, () => {
      const dir = tempDir({ "engine.json": content });
      const configPath = path.join(dir, "engine.json");
      try {
        withLocationEnv({ config: configPath }, () => {
          expect(() => loadRuntimeEnv({ schema: passthrough })).toThrow(configPath);
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test(`loadRuntimeEnv refuses a discovered .woofx3.json holding ${name}`, () => {
      const root = tempDir({ ".woofx3.json": content });
      try {
        withLocationEnv({ root }, () => {
          expect(() => loadRuntimeEnv({ schema: passthrough })).toThrow(path.join(root, ".woofx3.json"));
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test("loadRuntimeEnv refuses a WOOFX3_CONFIG naming a directory", () => {
    const dir = tempDir({});
    try {
      withLocationEnv({ config: dir }, () => {
        expect(() => loadRuntimeEnv({ schema: passthrough })).toThrow(dir);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadRuntimeEnv reads .woofx3.config when there is no .woofx3.json", () => {
    const root = tempDir({ ".woofx3.config": JSON.stringify({ locationFallbackFile: "from-config" }) });
    try {
      withLocationEnv({ root }, () => {
        const { config } = loadRuntimeEnv({ schema: passthrough });
        expect(config.woofx3LocationFallbackFile).toBe("from-config");
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("loadRuntimeEnv refuses a WOOFX3_CONFIG naming a missing file", () => {
    withLocationEnv({ config: path.join(process.cwd(), "tmp-runtime-location-missing", "engine.json") }, () => {
      expect(() => loadRuntimeEnv({ schema: passthrough })).toThrow(CONFIG_FILE_ENV);
    });
  });
});
