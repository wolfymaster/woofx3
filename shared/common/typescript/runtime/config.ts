import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

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

const PROJECT_ROOT_MARKERS = [".woofx3.json", ".woofx3.config"] as const;

/**
 * Find project root by walking up from startDir until we find .woofx3.json, .woofx3.config, .env, or package.json.
 */
export function findProjectRoot(startDir?: string): string {
  let dir = startDir ?? process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (PROJECT_ROOT_MARKERS.some((name) => fs.existsSync(path.join(dir, name)))) {
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
 * Load .woofx3.json or .woofx3.config from rootDir if present (prefers .woofx3.json). Expects JSON with camelCase keys.
 */
function loadWoofx3ConfigFile(rootDir: string): Record<string, string | number | boolean> | null {
  for (const name of [".woofx3.json", ".woofx3.config"]) {
    const configPath = path.join(rootDir, name);
    if (!fs.existsSync(configPath)) continue;
    try {
      const content = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return coerceConfigValues(parsed);
    } catch {
      return null;
    }
  }
  return null;
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
  /** Project root directory. Defaults to findProjectRoot(). */
  rootDir?: string;
  /** If true, set process.env from the validated config (camelCase keys -> SCREAMING_SNAKE_CASE) so code that reads process.env still works. */
  injectIntoProcess?: boolean;
  /**
   * Schema that the final config must match exactly (no more, no less keys).
   * Config file and env are merged (file overrides env), coerced to a common format, then validated.
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
 * Load config file (.woofx3.json), then environment (process.env, .env). Coerce values to a common
 * format (string | number | boolean) so env and file can be merged. Precedence: .woofx3.json
 * overrides environment. Final config is validated against the schema and must match exactly.
 */
export function loadRuntimeEnv(options: LoadRuntimeEnvOptions): RuntimeEnvResult {
  const rootDir = options?.rootDir ?? findProjectRoot();
  const injectIntoProcess = options?.injectIntoProcess ?? false;
  const schema = options.schema;

  const woofx3Raw = loadWoofx3ConfigFile(rootDir);
  const configFromFile: Record<string, string | number | boolean> = {};
  if (woofx3Raw) {
    for (const [key, value] of Object.entries(woofx3Raw)) {
      configFromFile[fileKeyToCanonical(key)] = coerceValue(value);
    }
  }

  const envFromProcessAndDotenv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) envFromProcessAndDotenv[k] = v;
  }
  const dotenv = loadDotenvFile(rootDir);
  for (const [k, v] of Object.entries(dotenv)) {
    envFromProcessAndDotenv[k] = v;
  }

  const configFromEnv = buildConfigFromEnv(envFromProcessAndDotenv);
  const mergedConfig: Record<string, string | number | boolean> = {
    ...configFromEnv,
    ...configFromFile,
  };

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
