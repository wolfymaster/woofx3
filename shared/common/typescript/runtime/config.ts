import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { dataDir } from "./data-dir";

/**
 * Convert camelCase to SCREAMING_SNAKE_CASE for env key mapping.
 */
export function camelToScreamingSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/**
 * Convert SCREAMING_SNAKE_CASE to camelCase for config key mapping.
 */
export function screamingSnakeToCamel(s: string): string {
  const lower = s.toLowerCase();
  return lower
    .split("_")
    .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/**
 * Config file names read from a config root, in order of preference. Must match FileNames in
 * shared/common/golang/config/location.go and CONFIG_FILE_NAMES in shared/common/rust/runtime/src/lib.rs.
 */
const CONFIG_FILE_NAMES = [".woofx3.json", ".woofx3.config"] as const;

/**
 * Find the project root by walking up from startDir until a directory holds .woofx3.json or
 * .woofx3.config. Without one, startDir (default: the working directory) is the root.
 */
export function findProjectRoot(startDir?: string): string {
  let dir = startDir ?? process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (CONFIG_FILE_NAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir ?? process.cwd();
}

/**
 * Parse a .env file into a record of SCREAMING_SNAKE_CASE keys to string values.
 * Handles KEY=value, quoted values, and # comments.
 */
function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load .env from rootDir if present. Returns SCREAMING_SNAKE_CASE keys.
 */
function loadDotenvFile(rootDir: string): Record<string, string> {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  return parseDotenv(content);
}

/**
 * Read a JSON config file with camelCase keys. A file that exists but cannot be read, does not
 * parse, or does not hold a JSON object is an error: starting on defaults instead would hide a
 * typo in the deployment's config until something misbehaves.
 */
function readWoofx3ConfigFile(configPath: string): Record<string, string | number | boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configPath}: the config file must hold a JSON object`);
  }
  return coerceConfigValues(parsed as Record<string, unknown>);
}

/**
 * Load .woofx3.json or .woofx3.config from rootDir, preferring .woofx3.json. Neither existing is
 * not an error: a service can be configured entirely through WOOFX3_* variables.
 */
function loadWoofx3ConfigFile(rootDir: string): Record<string, string | number | boolean> | null {
  for (const name of CONFIG_FILE_NAMES) {
    const configPath = path.join(rootDir, name);
    if (fs.existsSync(configPath)) {
      return readWoofx3ConfigFile(configPath);
    }
  }
  return null;
}

/**
 * Names an explicit config file. It must exist: a deployment that names its config file and gets
 * an empty config instead would start with defaults it never asked for.
 * Must match ConfigFileEnv in shared/common/golang/config/location.go and CONFIG_FILE_ENV in
 * shared/common/rust/runtime/src/lib.rs.
 */
export const CONFIG_FILE_ENV = "WOOFX3_CONFIG";

/** Names the config root directory, holding .env and, unless WOOFX3_CONFIG is set, .woofx3.json. */
export const ROOT_DIR_ENV = "WOOFX3_ROOT";

/** Where configuration is read from. */
export interface ConfigLocation {
  /** Holds .env, and .woofx3.json unless `configPath` is set. */
  rootDir: string;
  /** An explicitly named config file, which must exist. */
  configPath?: string;
}

/**
 * Pick the config root and file, first match wins. Values are trimmed and blank counts as unset, as
 * in the Go and Rust loaders:
 * - `rootDir`: that directory's .env and .woofx3.json.
 * - WOOFX3_CONFIG: that file; .env from WOOFX3_ROOT if set, else the file's directory.
 * - WOOFX3_ROOT: that directory's .env and .woofx3.json.
 * - otherwise the nearest directory at or above the working directory holding a config file.
 */
export function resolveConfigLocation(
  rootDir: string | undefined,
  env: Record<string, string | undefined> = process.env
): ConfigLocation {
  const explicitRoot = rootDir?.trim();
  if (explicitRoot) {
    return { rootDir: path.resolve(explicitRoot) };
  }
  const rootValue = env[ROOT_DIR_ENV]?.trim();
  const rootFromEnv = rootValue ? path.resolve(rootValue) : undefined;
  const configFromEnv = env[CONFIG_FILE_ENV]?.trim();
  if (configFromEnv) {
    const configPath = path.resolve(configFromEnv);
    return { rootDir: rootFromEnv ?? path.dirname(configPath), configPath };
  }
  return { rootDir: rootFromEnv ?? findProjectRoot() };
}

/**
 * Coerce a value to config format (string | number | boolean). Used so env strings and JSON values compare in a common format.
 */
function coerceValue(value: unknown): string | number | boolean {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "boolean") return value;
  const s = String(value).trim();
  if (s === "") return "";
  const num = Number(s);
  if (!Number.isNaN(num) && String(num) === s) return num;
  if (s === "true" || s === "false") return s === "true";
  return s;
}

/**
 * Coerce a record of config values to string | number | boolean per key.
 */
function coerceConfigValues(raw: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = coerceValue(v);
  }
  return out;
}

/**
 * Build camelCase config from env vars (SCREAMING_SNAKE_CASE -> camelCase, values coerced).
 */
function buildConfigFromEnv(env: Record<string, string>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [envKey, value] of Object.entries(env)) {
    const camelKey = screamingSnakeToCamel(envKey);
    out[camelKey] = coerceValue(value);
  }
  return out;
}

/**
 * Resolved runtime config: exactly the schema-validated config (camelCase keys).
 * No separate env view; use config or getConfig with schema key names.
 */
export interface RuntimeEnvResult {
  /** Schema-validated config (camelCase keys matching the schema). */
  config: Record<string, string | number | boolean>;
  /** Get a value by camelCase config key. */
  getConfig(key: string): string | number | boolean | undefined;
}

/** Schema with a parse method (e.g. Zod). Used so config is validated and only schema-defined keys are exposed. */
export interface EnvConfigSchema {
  parse(config: Record<string, string | number | boolean>): unknown;
}

export interface LoadRuntimeEnvOptions {
  /** Project root directory; when set and not blank, WOOFX3_ROOT and WOOFX3_CONFIG are ignored. See resolveConfigLocation. */
  rootDir?: string;
  /** If true, set process.env from the validated config (camelCase keys -> SCREAMING_SNAKE_CASE) so code that reads process.env still works. */
  injectIntoProcess?: boolean;
  /**
   * Schema that the final config must match exactly (no more, no less keys).
   * Config file, .env and process.env are merged (process.env wins; see loadRuntimeEnv), coerced to a common format, then validated.
   * Required: the application only ever sees schema-validated config.
   */
  schema: EnvConfigSchema;
}

/**
 * Map a .woofx3.json key to the same canonical key as env (WOOFX3_X_Y -> woofx3Xy).
 * Keys already starting with "woofx3" stay as-is; others get the prefix so file and env merge.
 */
function fileKeyToCanonical(key: string): string {
  if (key.length >= 7 && key.slice(0, 7).toLowerCase() === "woofx3") return key;
  return `woofx3${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Merge config sources given lowest precedence first. A later source overrides an earlier one,
 * except that a blank value never masks a non-blank one: a `""` left in a baked config file, or
 * an unset variable passed through by a compose file, means "not set here". A key blank in every
 * source still resolves, to blank, so schemas that accept an empty string keep working.
 */
function mergeByPrecedence(
  sources: Array<Record<string, string | number | boolean>>
): Record<string, string | number | boolean> {
  const merged: Record<string, string | number | boolean> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== "" || !(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Load config from .woofx3.json, .env and process.env, coerced to a common format
 * (string | number | boolean) so they can be merged. Precedence, highest first: process.env,
 * then .env, then .woofx3.json -- a deployment configures by variables, so a value baked into
 * the file must never beat one the host set. Final config is validated against the schema and
 * must match exactly.
 */
export function loadRuntimeEnv(options: LoadRuntimeEnvOptions): RuntimeEnvResult {
  const { rootDir, configPath } = resolveConfigLocation(options?.rootDir);
  const injectIntoProcess = options?.injectIntoProcess ?? false;
  const schema = options.schema;

  if (configPath !== undefined && !fs.existsSync(configPath)) {
    throw new Error(`${CONFIG_FILE_ENV} names a config file that does not exist: ${configPath}`);
  }
  // Fails a relative WOOFX3_DATA_DIR at startup rather than at the first path resolved under it.
  dataDir(process.env);
  const woofx3Raw = configPath !== undefined ? readWoofx3ConfigFile(configPath) : loadWoofx3ConfigFile(rootDir);
  const configFromFile: Record<string, string | number | boolean> = {};
  if (woofx3Raw) {
    for (const [key, value] of Object.entries(woofx3Raw)) {
      configFromFile[fileKeyToCanonical(key)] = coerceValue(value);
    }
  }

  const processEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      processEnv[k] = v;
    }
  }

  const mergedConfig = mergeByPrecedence([
    configFromFile,
    buildConfigFromEnv(loadDotenvFile(rootDir)),
    buildConfigFromEnv(processEnv),
  ]);

  const config = schema.parse(mergedConfig) as Record<string, string | number | boolean>;

  if (injectIntoProcess) {
    for (const [key, value] of Object.entries(config)) {
      const envKey =
        key.length >= 7 && key.slice(0, 7).toLowerCase() === "woofx3"
          ? `WOOFX3_${camelToScreamingSnake(key.slice(7))}`
          : camelToScreamingSnake(key);
      process.env[envKey] = value === undefined || value === null ? "" : String(value);
    }
  }

  return {
    config,
    getConfig(key: string) {
      return config[key];
    },
  };
}

/**
 * Validate a resolved config object against a Zod schema.
 * Mirrors Go's FillEnvConfig: the config object should have camelCase keys
 * (as produced by loadRuntimeEnv's config output) and the schema defines
 * expected fields with validation rules.
 *
 * @param schema - A Zod schema defining expected config fields (camelCase keys).
 * @param config - The resolved config with camelCase keys and auto-detected types.
 * @returns The validated and typed config object.
 * @throws ZodError if validation fails (missing required fields, wrong types, etc.).
 */
export function fillEnvConfig<T extends z.ZodType>(
  schema: T,
  config: Record<string, string | number | boolean>
): z.infer<T> {
  return schema.parse(config);
}
