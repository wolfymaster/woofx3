import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Exposure } from "@woofx3/common/http/request-guard";

/**
 * Who may call `registerClient`:
 * - `open`: anyone who reaches the engine.
 * - `token`: only a caller presenting the registration token.
 * - `first`: trust on first use. Anyone, while the engine has no registered
 *   client; after that, only a caller presenting the registration token, or
 *   nobody when there is none.
 */
export type RegistrationMode = "open" | "token" | "first";

export const REGISTRATION_MODES: readonly RegistrationMode[] = ["open", "token", "first"];

export interface RegistrationPolicy {
  mode: RegistrationMode;
  /** The secret a caller presents; required in `token` mode, optional in `first`, absent in `open`. */
  token: string | null;
}

export interface RegistrationSettings {
  /** `WOOFX3_REGISTRATION_MODE`. */
  mode?: string;
  /** `WOOFX3_REGISTRATION_TOKEN`. */
  token?: string;
  /** `WOOFX3_REGISTRATION_TOKEN_FILE`. */
  tokenFile?: string;
}

/** 32 random bytes: as strong as the session secrets the db issues to clients. */
const GENERATED_TOKEN_BYTES = 32;

function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * Resolves the registration policy, throwing at startup on a contradiction
 * rather than running with a policy the operator did not ask for.
 *
 * With no mode set, a token means `token` and no token means `first`. Managed
 * engines are given `WOOFX3_REGISTRATION_TOKEN` alone and so stay in `token`
 * mode; a bring-your-own engine given nothing belongs to the first client that
 * registers (the dashboard's one-time handshake). `open` is never a default.
 */
export function resolveRegistrationPolicy(settings: RegistrationSettings): RegistrationPolicy {
  const envToken = blankToUndefined(settings.token);
  const tokenFile = blankToUndefined(settings.tokenFile);
  if (envToken !== undefined && tokenFile !== undefined) {
    throw new Error(
      "Config error: set WOOFX3_REGISTRATION_TOKEN or WOOFX3_REGISTRATION_TOKEN_FILE, not both; they could disagree"
    );
  }
  const token = tokenFile !== undefined ? readOrCreateTokenFile(tokenFile) : (envToken ?? null);

  const rawMode = blankToUndefined(settings.mode)?.trim().toLowerCase();
  if (rawMode === undefined) {
    return { mode: token === null ? "first" : "token", token };
  }
  if (!REGISTRATION_MODES.includes(rawMode as RegistrationMode)) {
    throw new Error(
      `Config error: WOOFX3_REGISTRATION_MODE is "${settings.mode}"; expected one of ${REGISTRATION_MODES.join(", ")}`
    );
  }
  const mode = rawMode as RegistrationMode;
  if (mode === "open" && token !== null) {
    throw new Error(
      "Config error: WOOFX3_REGISTRATION_MODE=open but a registration token is configured; remove one of them"
    );
  }
  if (mode === "token" && token === null) {
    throw new Error(
      "Config error: WOOFX3_REGISTRATION_MODE=token needs WOOFX3_REGISTRATION_TOKEN or WOOFX3_REGISTRATION_TOKEN_FILE"
    );
  }
  return { mode, token };
}

/**
 * Throws at startup when `open` registration would admit callers from beyond
 * this machine: with `exposure` `network` (a non-loopback bind, or the edge
 * forwarding to it, `WOOFX3_BEHIND_EDGE`), anyone who finds the engine could
 * register and then use every session method.
 */
export function assertRegistrationExposure(policy: RegistrationPolicy, exposure: Exposure): void {
  if (policy.mode === "open" && exposure === "network") {
    throw new Error(
      "Config error: WOOFX3_REGISTRATION_MODE=open is only allowed on an engine reachable over loopback alone; this one binds a non-loopback interface or sits behind the edge (WOOFX3_BEHIND_EDGE is true). Use first or token instead"
    );
  }
}

/**
 * Reads the registration token from `path`, first generating one there if
 * the file does not exist, so a parent process (a desktop shell) can read the
 * same file to register.
 *
 * The file is written whole under a temporary name, then hard-linked into
 * place: a link fails when the target exists, so a reader never sees a
 * partial file, and two engines starting at once both end up with the one
 * that was linked first. The temporary file is created 0600; on Windows the
 * mode bits are ignored and the file takes its directory's ACL, so the path
 * must be in a directory only the user can read.
 */
export function readOrCreateTokenFile(path: string): string {
  const target = resolve(path);
  const existing = readTokenFile(target);
  if (existing !== null) {
    return existing;
  }

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const token = randomBytes(GENERATED_TOKEN_BYTES).toString("base64url");
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, `${token}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  } finally {
    unlinkSync(temporary);
  }

  const written = readTokenFile(target);
  if (written === null) {
    throw new Error(`Config error: registration token file ${target} vanished after it was written`);
  }
  return written;
}

/** The token in `path`, or null when the file does not exist. An empty file is an error. */
function readTokenFile(path: string): string | null {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
  const token = contents.trim();
  if (token === "") {
    throw new Error(`Config error: registration token file ${path} is empty; delete it to have one generated`);
  }
  return token;
}
