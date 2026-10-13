import { describe, expect, test } from "bun:test";
import { GATEABLE_ENGINE_CAPABILITIES } from "@woofx3/api";
import { RPC_METHODS } from "../src/api-session";
import {
  ENTITLEMENT_GRANT_TYPE,
  EntitlementGrantError,
  parseEntitlementPublicKeys,
  verifyEntitlementGrant,
} from "../src/entitlement-grant";
import { EntitlementError, Entitlements, type EntitlementsDeps, GATED_METHODS } from "../src/entitlements";

const ENGINE = "eng-0a1b2c3d";
const NOW_MS = Date.UTC(2026, 9, 12);
const NOW_S = NOW_MS / 1000;

interface Signer {
  kid: string;
  publicKeys: string;
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

async function makeSigner(kid = "k1"): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    kid,
    publicKeys: `${kid}:${Buffer.from(raw).toString("base64url")}`,
    async sign(payload, header = { alg: "EdDSA", kid, typ: ENTITLEMENT_GRANT_TYPE }) {
      const input = `${encode(header)}.${encode(payload)}`;
      const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(input));
      return `${input}.${Buffer.from(new Uint8Array(signature)).toString("base64url")}`;
    },
  };
}

function grant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { aud: ENGINE, iat: NOW_S, exp: NOW_S + 7 * 86400, seq: 1, grants: ["a.one"], limits: {}, ...overrides };
}

describe("parseEntitlementPublicKeys", () => {
  test("reads several kid:key pairs", async () => {
    const [one, two] = [await makeSigner("k1"), await makeSigner("k2")];
    const keys = await parseEntitlementPublicKeys(` ${one.publicKeys} , ${two.publicKeys} `);
    expect([...keys.keys()]).toEqual(["k1", "k2"]);
  });

  test("refuses malformed, duplicate, short and empty key lists", async () => {
    const signer = await makeSigner();
    await expect(parseEntitlementPublicKeys("nokey")).rejects.toThrow("expected kid:key");
    await expect(parseEntitlementPublicKeys(`${signer.publicKeys},${signer.publicKeys}`)).rejects.toThrow("twice");
    await expect(parseEntitlementPublicKeys("k1:AAAA")).rejects.toThrow("expected 32");
    await expect(parseEntitlementPublicKeys(" , ")).rejects.toThrow("no keys");
  });
});

describe("verifyEntitlementGrant", () => {
  test("accepts a grant signed by a configured key for this engine", async () => {
    const signer = await makeSigner();
    const keys = await parseEntitlementPublicKeys(signer.publicKeys);
    const verified = await verifyEntitlementGrant(await signer.sign(grant()), keys, ENGINE);
    expect(verified).toEqual({ ...grant(), limits: {} } as never);
  });

  test("refuses an unknown key, a forged signature, a tampered payload and another engine's grant", async () => {
    const signer = await makeSigner();
    const other = await makeSigner("k2");
    const keys = await parseEntitlementPublicKeys(signer.publicKeys);
    await expect(verifyEntitlementGrant(await other.sign(grant()), keys, ENGINE)).rejects.toThrow("unknown key");

    const forger = await makeSigner("k1");
    await expect(verifyEntitlementGrant(await forger.sign(grant()), keys, ENGINE)).rejects.toThrow("does not verify");

    const [header, , signature] = (await signer.sign(grant())).split(".");
    const raised = Buffer.from(JSON.stringify(grant({ grants: ["a.one", "b.two"] }))).toString("base64url");
    await expect(verifyEntitlementGrant(`${header}.${raised}.${signature}`, keys, ENGINE)).rejects.toThrow(
      "does not verify"
    );

    await expect(verifyEntitlementGrant(await signer.sign(grant({ aud: "eng-other" })), keys, ENGINE)).rejects.toThrow(
      'not "eng-0a1b2c3d"'
    );
  });

  test("refuses other algorithms, types and shapes", async () => {
    const signer = await makeSigner();
    const keys = await parseEntitlementPublicKeys(signer.publicKeys);
    const none = await signer.sign(grant(), { alg: "none", kid: "k1", typ: ENTITLEMENT_GRANT_TYPE });
    await expect(verifyEntitlementGrant(none, keys, ENGINE)).rejects.toThrow(EntitlementGrantError);
    const jwt = await signer.sign(grant(), { alg: "EdDSA", kid: "k1", typ: "JWT" });
    await expect(verifyEntitlementGrant(jwt, keys, ENGINE)).rejects.toThrow(EntitlementGrantError);
    await expect(verifyEntitlementGrant("a.b", keys, ENGINE)).rejects.toThrow("compact JWS");
    const noSeq = await signer.sign(grant({ seq: undefined }));
    await expect(verifyEntitlementGrant(noSeq, keys, ENGINE)).rejects.toThrow("Malformed");
  });
});

interface Harness {
  entitlements: Entitlements;
  signer: Signer;
  stored: { token: string | null };
  clock: { now: number };
}

async function governed(options: { stored?: string | null; gateable?: string[] } = {}): Promise<Harness> {
  const signer = await makeSigner();
  const stored = { token: options.stored ?? null };
  const clock = { now: NOW_MS };
  const deps: EntitlementsDeps = {
    keys: await parseEntitlementPublicKeys(signer.publicKeys),
    audience: ENGINE,
    gateable: new Set(options.gateable ?? ["a.one", "b.two"]),
    readGrant: async () => stored.token,
    writeGrant: async (token) => {
      stored.token = token;
    },
    now: () => clock.now,
  };
  return { entitlements: new Entitlements(deps), signer, stored, clock };
}

const SUPPORTED = ["a.one", "b.two", "c.free"];

describe("Entitlements", () => {
  test("an ungoverned engine withholds nothing and takes no grants", async () => {
    const entitlements = new Entitlements({
      keys: null,
      audience: null,
      gateable: new Set(["a.one"]),
      readGrant: async () => null,
      writeGrant: async () => {},
      now: () => NOW_MS,
    });
    expect(entitlements.governed).toBe(false);
    expect(await entitlements.withheld(SUPPORTED)).toEqual([]);
    await entitlements.require("a.one");
    await expect(entitlements.setGrant("x.y.z")).rejects.toThrow("no entitlement keys");
  });

  test("refuses keys without an engine name", async () => {
    const signer = await makeSigner();
    const keys = await parseEntitlementPublicKeys(signer.publicKeys);
    expect(
      () =>
        new Entitlements({
          keys,
          audience: null,
          gateable: new Set(),
          readGrant: async () => null,
          writeGrant: async () => {},
          now: () => NOW_MS,
        })
    ).toThrow("WOOFX3_ENGINE_NAME");
  });

  test("withholds every gateable capability until a grant arrives, and never a non-gateable one", async () => {
    const { entitlements } = await governed();
    expect(await entitlements.withheld(SUPPORTED)).toEqual(["a.one", "b.two"]);
    await expect(entitlements.require("a.one")).rejects.toBeInstanceOf(EntitlementError);
    await entitlements.require("c.free");
  });

  test("uses a stored grant and stops at its expiry", async () => {
    const signer = await makeSigner();
    const token = await signer.sign(grant());
    const h = await governed({ stored: token });
    // A grant stored under a key that is not configured does not verify, so it is ignored.
    expect(await h.entitlements.withheld(SUPPORTED)).toEqual(["a.one", "b.two"]);

    const own = await governed();
    own.stored.token = await own.signer.sign(grant());
    expect(await own.entitlements.withheld(SUPPORTED)).toEqual(["b.two"]);
    own.clock.now = (NOW_S + 7 * 86400) * 1000;
    expect(await own.entitlements.withheld(SUPPORTED)).toEqual(["a.one", "b.two"]);
  });

  test("stores a newer grant and refuses an older or different one at the same seq", async () => {
    const h = await governed();
    const first = await h.signer.sign(grant({ seq: 5 }));
    expect(await h.entitlements.setGrant(first)).toEqual({ seq: 5 });
    expect(h.stored.token).toBe(first);
    expect(await h.entitlements.withheld(SUPPORTED)).toEqual(["b.two"]);

    expect(await h.entitlements.setGrant(first)).toEqual({ seq: 5 });
    const sameSeq = await h.signer.sign(grant({ seq: 5, grants: ["a.one", "b.two"] }));
    await expect(h.entitlements.setGrant(sameSeq)).rejects.toThrow("already held");
    const older = await h.signer.sign(grant({ seq: 4, grants: ["a.one", "b.two"] }));
    await expect(h.entitlements.setGrant(older)).rejects.toThrow("older than");

    const downgrade = await h.signer.sign(grant({ seq: 6, grants: [] }));
    expect(await h.entitlements.setGrant(downgrade)).toEqual({ seq: 6 });
    expect(await h.entitlements.withheld(SUPPORTED)).toEqual(["a.one", "b.two"]);
  });

  test("checks ordering against a grant stored before a restart", async () => {
    const h = await governed();
    h.stored.token = await h.signer.sign(grant({ seq: 9 }));
    const older = await h.signer.sign(grant({ seq: 8, grants: ["a.one", "b.two"] }));
    await expect(h.entitlements.setGrant(older)).rejects.toThrow("older than");
  });

  test("refuses an expired grant", async () => {
    const h = await governed();
    const expired = await h.signer.sign(grant({ exp: NOW_S }));
    await expect(h.entitlements.setGrant(expired)).rejects.toThrow("expired");
    expect(h.stored.token).toBeNull();
  });

  test("applies concurrent grants one at a time", async () => {
    const h = await governed();
    const [six, seven] = [await h.signer.sign(grant({ seq: 6 })), await h.signer.sign(grant({ seq: 7 }))];
    const results = await Promise.allSettled([h.entitlements.setGrant(seven), h.entitlements.setGrant(six)]);
    expect(results[0]).toEqual({ status: "fulfilled", value: { seq: 7 } });
    expect(results[1].status).toBe("rejected");
    expect(h.stored.token).toBe(seven);
  });
});

describe("GATED_METHODS", () => {
  test("gates only RPC methods, and only on gateable capabilities", () => {
    for (const [method, capability] of Object.entries(GATED_METHODS)) {
      expect(RPC_METHODS as readonly string[]).toContain(method);
      expect(GATEABLE_ENGINE_CAPABILITIES.has(capability as never)).toBe(true);
    }
  });

  test("never gates the methods that report and change entitlements", () => {
    expect(Object.keys(GATED_METHODS)).not.toContain("getEngineCapabilities");
    expect(Object.keys(GATED_METHODS)).not.toContain("setEntitlementGrant");
  });
});
