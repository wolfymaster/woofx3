import fs from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { MainConfigurationFile } from "./types";

/**
 * Reads the main configuration file (conf.json) from one of several expected locations.
 * Returns the parsed configuration as a MainConfigurationFile object.
 * Throws an error if the configuration file is not found in any of the expected locations.
 */
export function readConfigFile(): MainConfigurationFile {
	const cwd = process.cwd();
	const candidates = [
		path.join(cwd, "conf.json"),
		path.join(cwd, "..", "conf.json"),
		path.join(cwd, "..", "conf", "conf.json"),
	];

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) {
				const raw = fs.readFileSync(candidate, "utf8");
				const parsed = JSON.parse(raw) as MainConfigurationFile;
        // drop any values that are empty strings, null or undefined
        const result = {} as MainConfigurationFile;
        Object.keys(parsed).forEach( (key: string) => {
          const value = parsed[key];
          if (value !== "" && value !== null && value !== undefined) {
              result[key] = value;
          }
      });
				return result;
			}
		} catch {
			// continue trying other candidates
		}
	}

	throw new Error("conf.json not found in expected locations");
}

/**
 * Merges values from a configuration file object with those from an environment object.
 * Environment variables (in SNAKE_UPPER_CASE) override corresponding config file fields if present.
 * Converts overridden values to the appropriate type (number, boolean, or string) based on the config file.
 * Returns the resulting MainConfigurationFile object.
 */
export function mergeConfigWithEnvironment(
	configFile: MainConfigurationFile,
	envObj: Record<string, string | undefined>,
): MainConfigurationFile {
	const toSnakeUpper = (key: string) =>
		key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
	const fromSnakeUpperToCamel = (key: string) => {
		const lower = key.toLowerCase();
		return lower
			.split("_")
			.map((part, idx) =>
				idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
			)
			.join("");
	};

	const result: MainConfigurationFile = { ...configFile };
	for (const key of Object.keys(configFile) as Array<
		keyof MainConfigurationFile
	>) {
		const envKey = `WOOFX3_${toSnakeUpper(key as string)}`;
		if (envObj[envKey] !== undefined) {
			const currentValue = configFile[key];
			const incoming = envObj[envKey];
			if (typeof currentValue === "number") {
				const n = Number(incoming);
				if (!Number.isNaN(n)) {
					result[key] = n;
				}
			} else if (typeof currentValue === "boolean") {
				result[key] = ["1", "true", "yes", "on"].includes(
					incoming.toLowerCase(),
				);
			} else {
				result[key] = incoming;
			}
		}
	}

	// Add any additional WOOFX3_ prefixed env vars that are not in configFile
	for (const [envKey, value] of Object.entries(envObj)) {
		if (!envKey?.startsWith?.("WOOFX3_")) continue;
		if (value === undefined) continue;
		const rawKey = envKey.slice("WOOFX3_".length);
		if (!rawKey) continue;
		const camelKey = fromSnakeUpperToCamel(rawKey);
		// Skip if we already set it from the previous pass
		if (result[camelKey] !== undefined) continue;
		// Infer type from value
		const lowerVal = value.toLowerCase();
		if (lowerVal === "true" || lowerVal === "false" || ["1","0","yes","no","on","off"].includes(lowerVal)) {
			result[camelKey] = ["1","true","yes","on"].includes(lowerVal);
			continue;
		}
		const maybeNum = Number(value);
		if (!Number.isNaN(maybeNum) && value.trim() !== "") {
			result[camelKey] = maybeNum;
			continue;
		}
		result[camelKey] = value;
	}
	return result;
}

/**
 * Retrieves the process ID (PID) from a .pid file located at the given root path for the specified application.
 * Returns the PID as a number if the file exists and is valid, otherwise returns -1.
 */
export async function getPid(
	rootPath: string,
	applicationName: string,
): Promise<number> {
	try {
		const pidPath = path.join(rootPath, `${applicationName}.pid`);
		await access(pidPath);
		const content = await readFile(pidPath, "utf8");
		const n = Number(content.trim());
		return Number.isFinite(n) ? n : -1;
	} catch {
		return -1;
	}
}

export async function waitForApplicationReady() {
  // this function should take a string or string[]
  // it should wait until a pid
}