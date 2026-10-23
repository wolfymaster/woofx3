import { describe, expect, test } from "bun:test";
import {
  COMPANION_DASHBOARD_CREDENTIAL_SUBJECT,
  COMPANION_RELAY_CONFIG_SET_SUBJECT,
  parseDashboardCredentialReply,
  parseDashboardCredentialRequest,
  parseRelayConfigSetReply,
  parseRelayConfigSetRequest,
  parseRelayCredentialResponse,
  parseStoredRelayConfig,
  readStoredRelayConfig,
} from "./relay";

const STORED = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
  clientId: "dash-client",
};

const GRANT = {
  bridgeOrigin: STORED.bridgeOrigin,
  endpoints: STORED.endpoints,
  credential: "wfxr1.k1.eyJ2IjoxfQ.c2ln",
  expiresAt: 1_700_000_300_000,
};

describe("companion relay subjects", () => {
  test("sit under the reserved engine. prefix", () => {
    expect(COMPANION_DASHBOARD_CREDENTIAL_SUBJECT).toBe("engine.companion.dashboard_credential");
    expect(COMPANION_RELAY_CONFIG_SET_SUBJECT).toBe("engine.companion.relay_config.set");
  });
});

describe("parseStoredRelayConfig", () => {
  test("accepts a configuration with its client id", () => {
    expect(parseStoredRelayConfig(STORED)).toEqual(STORED);
  });

  for (const clientId of [undefined, "", 7]) {
    test(`refuses clientId ${JSON.stringify(clientId)}`, () => {
      expect(() => parseStoredRelayConfig({ ...STORED, clientId })).toThrow("clientId");
    });
  }

  test("is what readStoredRelayConfig reads, and anything else reads as nothing stored", () => {
    expect(readStoredRelayConfig(JSON.stringify(STORED))).toEqual(STORED);
    expect(readStoredRelayConfig(JSON.stringify({ ...STORED, clientId: "" }))).toBeNull();
    expect(readStoredRelayConfig("not json")).toBeNull();
    expect(readStoredRelayConfig(null)).toBeNull();
  });
});

describe("parseRelayCredentialResponse", () => {
  test("accepts a grant and relay: null", () => {
    expect(parseRelayCredentialResponse({ relay: GRANT })).toEqual({ relay: GRANT });
    expect(parseRelayCredentialResponse({ relay: null })).toEqual({ relay: null });
  });

  const bad: unknown[] = [
    null,
    {},
    { relay: "x" },
    { relay: { ...GRANT, expiresAt: Number.NaN } },
    { relay: { ...GRANT, expiresAt: "soon" } },
    { relay: { ...GRANT, credential: "wfxr2.k1.a.b" } },
    { relay: { ...GRANT, credential: "wfxr1.k1.a" } },
    { relay: { ...GRANT, bridgeOrigin: "http://c-abcdefghijkl.woofx3.tv" } },
    { relay: { ...GRANT, endpoints: [{ moduleId: "woofx3_obs", endpointId: "" }] } },
  ];
  for (const body of bad) {
    test(`refuses ${JSON.stringify(body)}`, () => {
      expect(() => parseRelayCredentialResponse(body)).toThrow();
    });
  }
});

type Case = [name: string, value: unknown, expected: unknown];

function table(parse: (value: unknown) => unknown, accepted: Case[], refused: Array<[name: string, value: unknown]>) {
  for (const [name, value, expected] of accepted) {
    test(`accepts ${name}`, () => {
      expect(parse(value)).toEqual({ ok: true, value: expected });
    });
  }
  for (const [name, value] of refused) {
    test(`refuses ${name}`, () => {
      expect(parse(value)).toMatchObject({ ok: false, error: expect.any(String) });
    });
  }
}

describe("parseDashboardCredentialRequest", () => {
  table(
    parseDashboardCredentialRequest,
    [["a client id", { clientId: "dash-client" }, { clientId: "dash-client" }]],
    [
      ["a body that is not an object", "dash-client"],
      ["an array", ["dash-client"]],
      ["an empty client id", { clientId: "" }],
      ["no client id", {}],
    ]
  );
});

describe("parseDashboardCredentialReply", () => {
  table(
    parseDashboardCredentialReply,
    [
      [
        "an answered grant",
        { status: "answered", clientId: "dash-client", answer: { relay: GRANT } },
        { status: "answered", clientId: "dash-client", answer: { relay: GRANT } },
      ],
      [
        "an answered null",
        { status: "answered", clientId: "dash-client", answer: { relay: null } },
        { status: "answered", clientId: "dash-client", answer: { relay: null } },
      ],
      ["a failure", { status: "failed", error: "HTTP 503" }, { status: "failed", error: "HTTP 503" }],
    ],
    [
      ["null", null],
      ["an unknown status", { status: "ok" }],
      ["an answer with no client id", { status: "answered", answer: { relay: null } }],
      [
        "an answer with a malformed grant",
        { status: "answered", clientId: "d", answer: { relay: { ...GRANT, credential: "x" } } },
      ],
      ["an answer with no relay field", { status: "answered", clientId: "d", answer: {} }],
      ["a failure with no error", { status: "failed" }],
    ]
  );
});

describe("parseRelayConfigSetRequest", () => {
  table(
    parseRelayConfigSetRequest,
    [
      ["a stored configuration", { config: STORED }, { config: STORED }],
      ["null, which clears it", { config: null }, { config: null }],
    ],
    [
      ["no config field", {}],
      ["a body that is not an object", null],
      ["a configuration without a client id", { config: { ...STORED, clientId: undefined } }],
      ["a configuration with a plain http bridge", { config: { ...STORED, bridgeOrigin: "http://c.woofx3.tv" } }],
      [
        "a configuration with a bad endpoint",
        { config: { ...STORED, endpoints: [{ moduleId: "..", endpointId: "obs" }] } },
      ],
    ]
  );
});

describe("parseRelayConfigSetReply", () => {
  table(
    parseRelayConfigSetReply,
    [
      ["stored", { status: "stored" }, { status: "stored" }],
      ["a failure", { status: "failed", error: "db down" }, { status: "failed", error: "db down" }],
    ],
    [
      ["null", null],
      ["an unknown status", { status: "ok" }],
      ["a failure with no error", { status: "failed", error: 7 }],
    ]
  );
});
