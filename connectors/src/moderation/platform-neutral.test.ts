import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MODULE_DIR = import.meta.dir;
const SHARED_DIR = resolve(MODULE_DIR, "../../../shared/clients/typescript/api");
/** Words that would mean a platform's specifics leaked into the platform-neutral moderation code. */
const PLATFORM_WORDS = /twitch|helix/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => file !== import.meta.path);
}

const SHARED_FILES = readdirSync(SHARED_DIR)
  .filter((name) => name.startsWith("moderation-") && name.endsWith(".ts"))
  .map((name) => join(SHARED_DIR, name));

// Twitch's own rules (scopes, Helix calls, its limits) belong in its adapter
// and its egress handlers; moderation reaches every platform through the gateway.
test("moderation names no platform", () => {
  const files = [...sourceFiles(MODULE_DIR), ...SHARED_FILES];
  expect(SHARED_FILES.length).toBeGreaterThan(0);
  const offenders = files.filter((file) => PLATFORM_WORDS.test(readFileSync(file, "utf8")));
  expect(offenders).toEqual([]);
});
