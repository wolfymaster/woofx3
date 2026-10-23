import { describe, expect, test } from "bun:test";
import {
  type ClaimPairingResponse,
  newPairingVerifier,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  pairingVerifierHash,
  type StartPairingResponse,
} from "@woofx3/api/pairing";
import type { ClientPairingStartedEvent } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import { type CreatePairedClient, PairingRegistry, pairingOriginOf } from "../src/pairing";
import { DEFAULT_PAIRING_CONFIG, type PairingConfig, validatePairingConfig } from "../src/pairing-config";

const ORIGIN = "http://localhost:5173";
const OTHER = "https://other.example";

/** A logger that keeps every line, for asserting what is logged. */
function recordingLogger() {
  const lines: { level: string; message: string; fields: Record<string, unknown> }[] = [];
  const at =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) => {
      lines.push({ level, message, fields });
    };
  const logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
  return { logger: logger as unknown as SharedLogger, lines };
}

/** A registry on a clock the test moves, with db-proxy's client creation recorded. */
function registry(overrides: Partial<PairingConfig> = {}, create?: CreatePairedClient) {
  let now = Date.UTC(2026, 9, 23, 12, 0, 0);
  let ids = 0;
  const created: { description: string; origin: string }[] = [];
  const events: ClientPairingStartedEvent[] = [];
  const { logger, lines } = recordingLogger();
  const pairings = new PairingRegistry({
    config: { ...DEFAULT_PAIRING_CONFIG, ...overrides },
    logger,
    createPairedClient:
      create ??
      (async (request) => {
        created.push(request);
        return { clientId: `client-${created.length}`, clientSecret: `secret-${created.length}` };
      }),
    emit: (event) => events.push(event),
    now: () => now,
    newId: () => `pairing-${++ids}`,
  });
  return {
    pairings,
    created,
    events,
    lines,
    advance(ms: number) {
      now += ms;
    },
  };
}

/** A browser's side of one pairing: its verifier, and its start. */
async function startFrom(pairings: PairingRegistry, origin: string | null = ORIGIN, description = "Chrome on Windows") {
  const verifier = newPairingVerifier();
  const response = await pairings.start({ description, verifierHash: await pairingVerifierHash(verifier) }, origin);
  return { verifier, response };
}

function started(response: StartPairingResponse) {
  if (!response.ok) {
    throw new Error(`pairing did not start: ${response.code}`);
  }
  return response.pairing;
}

describe("pairingOriginOf", () => {
  test.each([
    ["http://localhost:5173", "http://localhost:5173"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["https://app.example.com", "https://app.example.com"],
    ["HTTPS://App.Example.com:443", "https://app.example.com"],
  ])("lets %p pair as %p", (origin, expected) => {
    expect(pairingOriginOf(origin)).toBe(expected);
  });

  test.each([
    ["no Origin", null],
    ["the opaque origin", "null"],
    ["plain http on another host", "http://192.168.1.20:5173"],
    ["plain http on a public name", "http://app.example.com"],
    ["the desktop window", "tauri://localhost"],
    ["the desktop window on Windows", "http://tauri.localhost"],
    ["the desktop window on Windows over https", "https://tauri.localhost"],
    ["a file page", "file:///home/me/index.html"],
    ["not a URL", "localhost:5173"],
  ])("refuses %s", (_, origin) => {
    expect(pairingOriginOf(origin)).toBeNull();
  });
});

describe("validatePairingConfig", () => {
  test("accepts the defaults", () => {
    expect(validatePairingConfig(DEFAULT_PAIRING_CONFIG)).toEqual(DEFAULT_PAIRING_CONFIG);
  });

  test.each([
    ["a zero limit", { maxPending: 0 }],
    ["a fractional limit", { ttlMs: 1.5 }],
    ["more per origin than in total", { maxPendingPerOrigin: 6 }],
    ["more starts per origin than in total", { startsPerOriginPerMinute: 21 }],
  ])("refuses %s", (_, override) => {
    expect(() => validatePairingConfig({ ...DEFAULT_PAIRING_CONFIG, ...override })).toThrow();
  });
});

describe("starting a pairing", () => {
  test("binds it to the origin, gives a code, announces it without the code, and logs the code", async () => {
    const { pairings, events, lines } = registry();

    const pairing = started((await startFrom(pairings, "HTTP://LOCALHOST:5173")).response);

    expect(pairing.pairingId).toBe("pairing-1");
    expect(normalizePairingCode(pairing.userCode)).toBe(pairing.userCode);
    expect([...pairing.userCode].every((char) => PAIRING_CODE_ALPHABET.includes(char))).toBe(true);
    expect(pairing.expiresAt).toBe("2026-10-23T12:10:00.000Z");
    expect(pairing.pollIntervalMs).toBe(5_000);
    expect(events).toEqual([
      {
        type: "client.pairing.started",
        pairingId: "pairing-1",
        origin: ORIGIN,
        description: "Chrome on Windows",
        expiresAt: pairing.expiresAt,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(pairing.userCode);
    expect(lines.find((line) => line.message === "Pairing started")?.fields.userCode).toBe(pairing.userCode);
  });

  test.each([
    ["an empty description", { description: "  " }],
    ["a description over 64 characters", { description: "x".repeat(65) }],
    ["a control character", { description: "Chrome\u0007" }],
    ["a malformed verifier hash", { verifierHash: "not-a-hash" }],
    ["no description", { description: undefined }],
  ])("refuses %s", async (_, override) => {
    const { pairings, events } = registry();
    const request = {
      description: "Chrome",
      verifierHash: await pairingVerifierHash(newPairingVerifier()),
      ...override,
    };

    const response = await pairings.start(request as never, ORIGIN);

    expect(response).toMatchObject({ ok: false, code: "invalid_request" });
    expect(events).toEqual([]);
  });

  test("refuses an origin that may not pair", async () => {
    const { pairings } = registry();

    expect((await startFrom(pairings, "http://192.168.1.20:5173")).response).toMatchObject({
      ok: false,
      code: "origin_refused",
    });
  });

  test("holds at most two waiting pairings per origin and five in all", async () => {
    const { pairings } = registry();
    const origins = ["https://a.example", "https://b.example", "https://c.example"];

    const results = [];
    for (const origin of [origins[0], origins[0], origins[0], origins[1], origins[1], origins[2], origins[2]]) {
      results.push((await startFrom(pairings, origin)).response);
    }

    expect(results.map((result) => (result.ok ? "ok" : result.code))).toEqual([
      "ok",
      "ok",
      "too_many_pending",
      "ok",
      "ok",
      "ok",
      "too_many_pending",
    ]);
  });

  test("limits starts from one origin per minute, and says when to retry", async () => {
    const { pairings, advance } = registry({ maxPending: 10, maxPendingPerOrigin: 10 });
    for (let i = 0; i < 6; i++) {
      started((await startFrom(pairings)).response);
      advance(1_000);
    }

    const limited = (await startFrom(pairings)).response;
    expect(limited).toMatchObject({ ok: false, code: "rate_limited", retryAfterMs: 54_000 });

    advance(54_000);
    expect((await startFrom(pairings)).response.ok).toBe(true);
  });

  test("limits starts from every origin together per minute", async () => {
    const { pairings } = registry({ maxPending: 30, maxPendingPerOrigin: 2 });
    for (let i = 0; i < 20; i++) {
      started((await startFrom(pairings, `https://site-${i}.example`)).response);
    }

    expect((await startFrom(pairings, "https://site-20.example")).response).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
  });

  test("frees a slot when a waiting pairing expires", async () => {
    const { pairings, advance } = registry();
    started((await startFrom(pairings)).response);
    started((await startFrom(pairings)).response);
    expect((await startFrom(pairings)).response).toMatchObject({ code: "too_many_pending" });

    advance(10 * 60_000);

    expect((await startFrom(pairings)).response.ok).toBe(true);
  });

  test("never gives two waiting pairings the same code, whatever the random source draws", async () => {
    let draw = 0;
    // The first two codes drawn are the same; the third differs.
    const streams = [new Uint8Array(8).fill(0), new Uint8Array(8).fill(0), new Uint8Array(8).fill(1)];
    const pairings = new PairingRegistry({
      config: DEFAULT_PAIRING_CONFIG,
      logger: recordingLogger().logger,
      createPairedClient: async () => ({ clientId: "c", clientSecret: "s" }),
      emit: () => {},
      randomBytes: () => streams[Math.min(draw++, streams.length - 1)],
    });

    const first = started((await startFrom(pairings, "https://a.example")).response);
    const second = started((await startFrom(pairings, "https://b.example")).response);

    expect(first.userCode).toBe("BBBBBBBB");
    expect(second.userCode).toBe("CCCCCCCC");
  });

  test("draws only bytes that keep every code character equally likely", async () => {
    const pairings = new PairingRegistry({
      config: DEFAULT_PAIRING_CONFIG,
      logger: recordingLogger().logger,
      createPairedClient: async () => ({ clientId: "c", clientSecret: "s" }),
      emit: () => {},
      // 243 and above would make the first alphabet letters likelier; they are skipped.
      randomBytes: () => new Uint8Array([255, 243, 250, 27, 28, 29, 30, 31]),
    });

    const pairing = started((await startFrom(pairings)).response);

    expect(pairing.userCode).toBe("BCDFGBCD");
  });
});

describe("claiming a pairing", () => {
  test("is pending until approved, then returns the credentials exactly once", async () => {
    const { pairings, created, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const pairing = started(response);

    expect(await pairings.claim({ pairingId: pairing.pairingId, verifier }, ORIGIN)).toEqual({ status: "pending" });
    expect(pairings.decide({ pairingId: pairing.pairingId, decision: "approve" }, "desktop")).toEqual({ ok: true });
    advance(5_000);

    expect(await pairings.claim({ pairingId: pairing.pairingId, verifier }, ORIGIN)).toEqual({
      status: "approved",
      credentials: { clientId: "client-1", clientSecret: "secret-1" },
    });
    expect(created).toEqual([{ description: "Chrome on Windows", origin: ORIGIN }]);
    advance(5_000);
    expect(await pairings.claim({ pairingId: pairing.pairingId, verifier }, ORIGIN)).toEqual({ status: "not_found" });
  });

  test("answers a denied pairing once, then forgets it", async () => {
    const { pairings, created, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);

    pairings.decide({ pairingId, decision: "deny" }, "desktop");

    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "denied" });
    advance(5_000);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "not_found" });
    expect(created).toEqual([]);
  });

  test("tells a browser that polls too soon to slow down, by five seconds each time", async () => {
    const { pairings, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);

    await pairings.claim({ pairingId, verifier }, ORIGIN);
    advance(1_000);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({
      status: "slow_down",
      pollIntervalMs: 10_000,
    });
    advance(5_000);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({
      status: "slow_down",
      pollIntervalMs: 15_000,
    });
    advance(15_000);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "pending" });
  });

  test("answers a wrong verifier or origin as a pairing that does not exist, and ends it after three", async () => {
    const { pairings, created } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);
    pairings.decide({ pairingId, decision: "approve" }, "desktop");

    const wrongs: ClaimPairingResponse[] = [
      await pairings.claim({ pairingId, verifier: newPairingVerifier() }, ORIGIN),
      await pairings.claim({ pairingId, verifier }, OTHER),
      await pairings.claim({ pairingId, verifier: "not a verifier" }, ORIGIN),
    ];

    expect(wrongs).toEqual([{ status: "not_found" }, { status: "not_found" }, { status: "not_found" }]);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "not_found" });
    expect(created).toEqual([]);
  });

  test("does not reveal that an unknown caller's pairing expired", async () => {
    const { pairings, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);
    advance(10 * 60_000);

    expect(await pairings.claim({ pairingId, verifier: newPairingVerifier() }, ORIGIN)).toEqual({
      status: "not_found",
    });
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "expired" });
  });

  test("of two claims at once, only one creates a client", async () => {
    let finish: () => void = () => {};
    const creating = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let creates = 0;
    const { pairings, advance } = registry({}, async () => {
      creates++;
      await creating;
      return { clientId: "only", clientSecret: "once" };
    });
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);
    pairings.decide({ pairingId, decision: "approve" }, "desktop");

    const first = pairings.claim({ pairingId, verifier }, ORIGIN);
    // A poll interval apart, so the second is not merely told to slow down.
    advance(5_000);
    const second = pairings.claim({ pairingId, verifier }, ORIGIN);
    await Bun.sleep(5);
    finish();
    const answers = await Promise.all([first, second]);

    expect(creates).toBe(1);
    expect(answers).toEqual([
      { status: "approved", credentials: { clientId: "only", clientSecret: "once" } },
      { status: "pending" },
    ]);
  });

  test("keeps the pairing approved when db-proxy fails, so the next poll retries", async () => {
    let fail = true;
    const { pairings, advance } = registry({}, async () => {
      if (fail) {
        throw new Error("db-proxy unavailable");
      }
      return { clientId: "c", clientSecret: "s" };
    });
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);
    pairings.decide({ pairingId, decision: "approve" }, "desktop");

    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({
      status: "failed",
      retryable: true,
      error: "db-proxy unavailable",
    });
    fail = false;
    advance(5_000);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toMatchObject({ status: "approved" });
  });

  test("an approval that is never claimed expires without creating a client", async () => {
    const { pairings, created, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);
    pairings.decide({ pairingId, decision: "approve" }, "desktop");

    advance(10 * 60_000);

    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "expired" });
    expect(created).toEqual([]);
  });
});

describe("deciding a pairing", () => {
  test("an approval that lands after expiry is refused, and the pairing never becomes a client", async () => {
    const { pairings, created, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);
    advance(10 * 60_000);

    expect(pairings.decide({ pairingId, decision: "approve" }, "desktop")).toEqual({ ok: false, code: "expired" });
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toEqual({ status: "not_found" });
    expect(created).toEqual([]);
  });

  test("one approval just before expiry is claimed if the claim is just before it too", async () => {
    const { pairings, advance } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);

    advance(10 * 60_000 - 2);
    expect(pairings.decide({ pairingId, decision: "approve" }, "desktop")).toEqual({ ok: true });
    advance(1);
    expect(await pairings.claim({ pairingId, verifier }, ORIGIN)).toMatchObject({ status: "approved" });
  });

  test.each([
    ["an unknown pairing", "pairing-9", "approve", "not_found"],
    ["an unknown decision", "pairing-1", "maybe", "not_found"],
  ])("refuses %s", async (_, pairingId, decision, code) => {
    const { pairings } = registry();
    started((await startFrom(pairings)).response);

    expect<unknown>(pairings.decide({ pairingId, decision } as never, "desktop")).toEqual({ ok: false, code });
  });

  test("a second decision is refused", async () => {
    const { pairings } = registry();
    const { pairingId } = started((await startFrom(pairings)).response);
    pairings.decide({ pairingId, decision: "deny" }, "desktop");

    expect(pairings.decide({ pairingId, decision: "approve" }, "other-approver")).toEqual({
      ok: false,
      code: "already_decided",
    });
  });

  test("logs who decided", async () => {
    const { pairings, lines } = registry();
    const { pairingId } = started((await startFrom(pairings)).response);

    pairings.decide({ pairingId, decision: "approve" }, "desktop");

    expect(lines.find((line) => line.message === "Pairing approved")?.fields).toMatchObject({
      pairingId,
      origin: ORIGIN,
      approverClientId: "desktop",
    });
  });
});

describe("looking up and listing pairings", () => {
  test("finds a pairing by its code as typed, with the origin to show", async () => {
    const { pairings } = registry();
    const pairing = started((await startFrom(pairings)).response);
    const typed = `${pairing.userCode.slice(0, 4).toLowerCase()}-${pairing.userCode.slice(4)}`;

    expect(pairings.lookup({ userCode: typed })).toEqual({
      ok: true,
      pairing: {
        pairingId: pairing.pairingId,
        origin: ORIGIN,
        description: "Chrome on Windows",
        startedAt: "2026-10-23T12:00:00.000Z",
        expiresAt: "2026-10-23T12:10:00.000Z",
        status: "pending",
      },
    });
  });

  test.each([
    ["a malformed code", "ABC", "invalid_code"],
    ["no code", undefined, "invalid_code"],
    ["a code nobody shows", "BCDF-GHJK", "not_found"],
  ])("answers %s", async (_, userCode, code) => {
    const { pairings } = registry({}, undefined);
    expect<unknown>(pairings.lookup({ userCode } as never)).toEqual({ ok: false, code });
  });

  test("lists pairings waiting for a decision or a claim, not denied or expired ones", async () => {
    const { pairings, advance } = registry({ maxPendingPerOrigin: 3 });
    const waiting = started((await startFrom(pairings)).response);
    const approved = started((await startFrom(pairings)).response);
    const denied = started((await startFrom(pairings, "https://other.example")).response);
    pairings.decide({ pairingId: approved.pairingId, decision: "approve" }, "desktop");
    pairings.decide({ pairingId: denied.pairingId, decision: "deny" }, "desktop");

    const listed = pairings.listPending();
    expect(listed.ok && listed.pairings.map((pairing) => [pairing.pairingId, pairing.status])).toEqual([
      [waiting.pairingId, "pending"],
      [approved.pairingId, "approved"],
    ]);

    advance(10 * 60_000);
    expect(pairings.listPending()).toEqual({ ok: true, pairings: [] });
  });
});

describe("cancelling a pairing", () => {
  test("its browser can give it up", async () => {
    const { pairings } = registry();
    const { verifier, response } = await startFrom(pairings);
    const { pairingId } = started(response);

    expect(await pairings.cancel({ pairingId, verifier }, ORIGIN)).toEqual({ ok: true });
    expect(pairings.lookup({ userCode: started(response).userCode })).toEqual({ ok: false, code: "not_found" });
  });

  test("a stranger cannot", async () => {
    const { pairings } = registry();
    const { response } = await startFrom(pairings);
    const { pairingId } = started(response);

    expect(await pairings.cancel({ pairingId, verifier: newPairingVerifier() }, ORIGIN)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(pairings.listPending()).toMatchObject({ ok: true, pairings: [{ pairingId }] });
  });
});
