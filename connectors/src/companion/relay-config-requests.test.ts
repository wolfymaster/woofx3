import { describe, expect, mock, test } from "bun:test";
import type { StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { bytes, RecordingLogger, text } from "../host/testing";
import { RELAY_CONFIG_SET_DEFAULTS, RelayConfigRequests } from "./relay-config-requests";

const STORED: StoredRelayConfig = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
  clientId: "dash-client",
};

function requests(setConfig = mock(async (_config: StoredRelayConfig | null) => {})) {
  const logger = new RecordingLogger();
  return { setConfig, logger, served: new RelayConfigRequests({ source: { setConfig }, logger }) };
}

describe("RelayConfigRequests", () => {
  test("serves engine.companion.relay_config.set as raw JSON, inside the api's request timeout", () => {
    const spec = requests().served.spec();
    expect(spec.subject).toBe("engine.companion.relay_config.set");
    expect(spec.replyMode).toBe("raw");
    expect(spec.budgetMs).toBe(RELAY_CONFIG_SET_DEFAULTS.budgetMs);
    expect(RELAY_CONFIG_SET_DEFAULTS.budgetMs).toBeLessThan(5_000);
  });

  test("stores a configuration and clears on null, answering stored", async () => {
    const { setConfig, served } = requests();
    expect(await served.handle({ config: STORED })).toEqual({ status: "stored" });
    expect(await served.handle({ config: null })).toEqual({ status: "stored" });
    expect(setConfig.mock.calls as unknown[]).toEqual([[STORED], [null]]);
  });

  test("answers a failed write as failed, naming why", async () => {
    const { served, logger } = requests(
      mock(async () => {
        throw new Error("db-proxy SetSetting: unavailable");
      })
    );
    expect(await served.handle({ config: STORED })).toEqual({
      status: "failed",
      error: "db-proxy SetSetting: unavailable",
    });
    expect(logger.at("warn")).toHaveLength(1);
  });

  const parses: Array<[name: string, raw: string, ok: boolean]> = [
    ["a configuration", JSON.stringify({ config: STORED }), true],
    ["null", JSON.stringify({ config: null }), true],
    ["no config field", JSON.stringify({}), false],
    ["a configuration without a client id", JSON.stringify({ config: { ...STORED, clientId: "" } }), false],
    [
      "a configuration the dialer cannot use",
      JSON.stringify({ config: { ...STORED, bridgeOrigin: "http://c-abcdefghijkl.woofx3.tv" } }),
      false,
    ],
    ["a body that is not JSON", "{", false],
  ];
  for (const [name, raw, ok] of parses) {
    test(`${ok ? "accepts" : "refuses"} ${name}`, () => {
      expect(requests().served.spec().parse(bytes(raw)).ok).toBe(ok);
    });
  }

  test("answers the host's own refusals as failed", () => {
    const reply = requests().served.spec().errorReply("invalid", "clientId must be a non-empty string");
    expect(JSON.parse(text(reply))).toEqual({
      status: "failed",
      error: "invalid: clientId must be a non-empty string",
    });
  });
});
