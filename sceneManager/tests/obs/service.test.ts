import { describe, expect, it } from "bun:test";
import { createObsService } from "../../src/obs/service";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

function service() {
  const db = { getSetting: async () => null } as never;
  return createObsService({
    db,
    nats: null,
    obs: { host: "127.0.0.1", port: 4455 } as never,
    overlayPort: 20505,
    logger,
  });
}

describe("createObsService", () => {
  it("reports a connection not yet attempted without touching OBS", () => {
    expect(service().status()).toMatchObject({ state: "connecting", failure: null, address: null });
  });

  it("stops cleanly without having started", async () => {
    const obs = service();
    await obs.stop();
    expect(obs.status().state).toBe("stopped");
  });
});
