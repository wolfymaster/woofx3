import { describe, expect, mock, test } from "bun:test";
import { RELAY_API_REQUEST_TIMEOUT_MS, type StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { bytes, RecordingLogger, text } from "../host/testing";
import { RELAY_CONFIG_SET_DEFAULTS, RelayConfigRequests } from "./relay-config-requests";

const STORED: StoredRelayConfig = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
  clientId: "dash-client",
};

const running = () => new AbortController().signal;

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
    expect(RELAY_CONFIG_SET_DEFAULTS.budgetMs).toBeLessThan(RELAY_API_REQUEST_TIMEOUT_MS);
  });

  test("stores a configuration and clears on null, answering stored", async () => {
    const { setConfig, served } = requests();
    expect(await served.handle({ config: STORED }, running())).toEqual({ status: "stored" });
    expect(await served.handle({ config: null }, running())).toEqual({ status: "stored" });
    expect(setConfig.mock.calls as unknown[]).toEqual([[STORED], [null]]);
  });

  test("answers a failed write as failed, naming why", async () => {
    const { served, logger } = requests(
      mock(async () => {
        throw new Error("db-proxy SetSetting: unavailable");
      })
    );
    expect(await served.handle({ config: STORED }, running())).toEqual({
      status: "failed",
      error: "db-proxy SetSetting: unavailable",
    });
    expect(logger.at("warn")).toHaveLength(1);
  });

  test("answers failed when the budget runs out on a held write, and logs the write's late failure", async () => {
    let failWrite: (error: Error) => void = () => {};
    const { served, logger } = requests(
      mock(
        () =>
          new Promise<void>((_resolve, reject) => {
            failWrite = reject;
          })
      )
    );
    const budget = new AbortController();
    const reply = served.handle({ config: STORED }, budget.signal);
    budget.abort(new Error("engine.companion.relay_config.set: the 4500ms budget ran out"));
    expect(await reply).toEqual({ status: "failed", error: "the budget ran out; the write may still land" });
    expect(logger.at("warn")).toHaveLength(1);
    failWrite(new Error("db-proxy SetSetting: unavailable"));
    await Bun.sleep(0);
    expect(logger.at("warn")).toHaveLength(2);
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
