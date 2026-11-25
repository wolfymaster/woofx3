import { describe, expect, test } from "bun:test";
import { FakeTime } from "../../../host/testing";
import type { KickResult } from "./kick-api";
import { KickSignatureVerifier, type SignedDelivery } from "./signature";

const ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

async function keyPair(): Promise<{ privateKey: CryptoKey; pem: string }> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const base64 = btoa(String.fromCharCode(...spki));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return {
    privateKey: pair.privateKey,
    pem: `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`,
  };
}

async function signed(privateKey: CryptoKey, body = '{"hello":"kick"}'): Promise<SignedDelivery> {
  const delivery = { messageId: "01MSG", timestamp: "2026-11-25T10:00:00Z", body: new TextEncoder().encode(body) };
  const bytes = new TextEncoder().encode(`${delivery.messageId}.${delivery.timestamp}.${body}`);
  const signature = new Uint8Array(await crypto.subtle.sign(ALGORITHM, privateKey, bytes));
  return { ...delivery, signature: btoa(String.fromCharCode(...signature)) };
}

/** Kick's key endpoint, serving `pems` in turn (the last one from then on); an Error is the endpoint failing. */
function keyEndpoint(...pems: (string | Error)[]) {
  let fetched = 0;
  return {
    fetched: () => fetched,
    api: {
      publicKey: async (): Promise<KickResult<string>> => {
        const pem = pems[Math.min(fetched, pems.length - 1)];
        fetched++;
        if (pem === undefined || pem instanceof Error) {
          return { ok: false, error: { kind: "timeout" } };
        }
        return { ok: true, value: pem };
      },
    },
  };
}

function verifier(api: ReturnType<typeof keyEndpoint>["api"], time = new FakeTime()) {
  return new KickSignatureVerifier({ api, clock: time, publicKeyRefetchMinIntervalMs: 60_000 });
}

describe("KickSignatureVerifier", () => {
  test("accepts a delivery Kick signed, fetching the key once", async () => {
    const { privateKey, pem } = await keyPair();
    const endpoint = keyEndpoint(pem);
    const check = verifier(endpoint.api);

    expect(await check.verify(await signed(privateKey))).toBe("valid");
    expect(await check.verify(await signed(privateKey, '{"again":1}'))).toBe("valid");
    expect(endpoint.fetched()).toBe(1);
  });

  const tampered: [name: string, change: (d: SignedDelivery) => SignedDelivery][] = [
    ["a flipped body byte", (d) => ({ ...d, body: Uint8Array.from(d.body, (b, i) => (i === 2 ? b ^ 1 : b)) })],
    ["another message id", (d) => ({ ...d, messageId: "01OTHER" })],
    ["another timestamp", (d) => ({ ...d, timestamp: "2026-11-25T10:00:01Z" })],
    ["a signature that is not base64", (d) => ({ ...d, signature: "not base64!" })],
  ];
  for (const [name, change] of tampered) {
    test(`refuses ${name}`, async () => {
      const { privateKey, pem } = await keyPair();
      expect(await verifier(keyEndpoint(pem).api).verify(change(await signed(privateKey)))).toBe("invalid");
    });
  }

  test("a key rotated since the last fetch is fetched again, and the delivery verifies against it", async () => {
    const old = await keyPair();
    const rotated = await keyPair();
    const time = new FakeTime();
    const endpoint = keyEndpoint(old.pem, rotated.pem);
    const check = verifier(endpoint.api, time);
    expect(await check.verify(await signed(old.privateKey))).toBe("valid");
    await time.advance(60_000);

    expect(await check.verify(await signed(rotated.privateKey))).toBe("valid");
    expect(endpoint.fetched()).toBe(2);
  });

  test("refetching is throttled, so forged deliveries cannot make it hammer Kick", async () => {
    const { privateKey, pem } = await keyPair();
    const forger = await keyPair();
    const time = new FakeTime();
    const endpoint = keyEndpoint(pem);
    const check = verifier(endpoint.api, time);
    await check.verify(await signed(privateKey));

    expect(await check.verify(await signed(forger.privateKey))).toBe("invalid");
    expect(await check.verify(await signed(forger.privateKey))).toBe("invalid");
    expect(endpoint.fetched()).toBe(1);

    await time.advance(60_000);
    expect(await check.verify(await signed(forger.privateKey))).toBe("invalid");
    expect(endpoint.fetched()).toBe(2);
  });

  test("no key from Kick is unavailable, never valid", async () => {
    const { privateKey } = await keyPair();
    expect(await verifier(keyEndpoint(new Error("down")).api).verify(await signed(privateKey))).toBe("unavailable");
  });

  test("a key WebCrypto cannot import is unavailable", async () => {
    const { privateKey } = await keyPair();
    const garbage = "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----";
    expect(await verifier(keyEndpoint(garbage).api).verify(await signed(privateKey))).toBe("unavailable");
  });
});
