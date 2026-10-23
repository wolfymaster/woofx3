import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRegistrationExposure, readOrCreateTokenFile, resolveRegistrationPolicy } from "../src/registration";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "woofx3-registration-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveRegistrationPolicy with no mode set", () => {
  it("is first (trust on first use) without a token, never open", () => {
    expect(resolveRegistrationPolicy({})).toEqual({ mode: "first", token: null });
    expect(resolveRegistrationPolicy({ token: "  ", mode: "" })).toEqual({ mode: "first", token: null });
  });

  it("requires the token when one is set, as managed engines are", () => {
    expect(resolveRegistrationPolicy({ token: "managed-token" })).toEqual({ mode: "token", token: "managed-token" });
  });

  it("requires the token from a token file", () => {
    const path = join(dir, "registration-token");
    writeFileSync(path, "from-file\n");

    expect(resolveRegistrationPolicy({ tokenFile: path })).toEqual({ mode: "token", token: "from-file" });
  });
});

describe("assertRegistrationExposure", () => {
  it("refuses open registration on an engine reachable beyond loopback", () => {
    expect(() => assertRegistrationExposure({ mode: "open", token: null }, "network")).toThrow(
      "WOOFX3_REGISTRATION_MODE=open"
    );
  });

  it("allows open registration on a loopback-only engine", () => {
    expect(() => assertRegistrationExposure({ mode: "open", token: null }, "loopback")).not.toThrow();
  });

  it("allows first and token modes anywhere", () => {
    expect(() => assertRegistrationExposure({ mode: "first", token: null }, "network")).not.toThrow();
    expect(() => assertRegistrationExposure({ mode: "token", token: "t" }, "network")).not.toThrow();
  });
});

describe("resolveRegistrationPolicy with a mode set", () => {
  it("accepts each mode, case-insensitively", () => {
    expect(resolveRegistrationPolicy({ mode: "OPEN" })).toEqual({ mode: "open", token: null });
    expect(resolveRegistrationPolicy({ mode: "token", token: "t" })).toEqual({ mode: "token", token: "t" });
    expect(resolveRegistrationPolicy({ mode: "first" })).toEqual({ mode: "first", token: null });
    expect(resolveRegistrationPolicy({ mode: "first", token: "t" })).toEqual({ mode: "first", token: "t" });
  });

  it("refuses an unknown mode", () => {
    expect(() => resolveRegistrationPolicy({ mode: "closed" })).toThrow("WOOFX3_REGISTRATION_MODE");
  });

  it("refuses token mode without a token", () => {
    expect(() => resolveRegistrationPolicy({ mode: "token" })).toThrow("needs WOOFX3_REGISTRATION_TOKEN");
  });

  it("refuses open mode with a token", () => {
    expect(() => resolveRegistrationPolicy({ mode: "open", token: "t" })).toThrow("WOOFX3_REGISTRATION_MODE=open");
  });

  it("refuses a token and a token file together", () => {
    expect(() => resolveRegistrationPolicy({ token: "t", tokenFile: join(dir, "f") })).toThrow("not both");
  });
});

describe("readOrCreateTokenFile", () => {
  it("generates a strong token, owner-only, when the file is missing", () => {
    const path = join(dir, "nested", "registration-token");

    const token = readOrCreateTokenFile(path);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(path, "utf8").trim()).toBe(token);
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(join(dir, "nested"))).toEqual(["registration-token"]);
  });

  it("reads the same token back on the next start", () => {
    const path = join(dir, "registration-token");

    expect(readOrCreateTokenFile(path)).toBe(readOrCreateTokenFile(path));
  });

  it("keeps a file that already exists", () => {
    const path = join(dir, "registration-token");
    writeFileSync(path, "  chosen-by-the-shell \n");

    expect(readOrCreateTokenFile(path)).toBe("chosen-by-the-shell");
    expect(readFileSync(path, "utf8")).toBe("  chosen-by-the-shell \n");
  });

  it("refuses an empty file rather than accept an empty token", () => {
    const path = join(dir, "registration-token");
    writeFileSync(path, "\n");

    expect(() => readOrCreateTokenFile(path)).toThrow("is empty");
  });

  it("generates a different token for each new file", () => {
    expect(readOrCreateTokenFile(join(dir, "a"))).not.toBe(readOrCreateTokenFile(join(dir, "b")));
  });
});
