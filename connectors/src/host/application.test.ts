import { describe, expect, test } from "bun:test";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import { connectorsConfig } from "../config";
import { ListCommandsResponse } from "@woofx3/db/command.pb";
import ConnectorsApplication, { type ConnectorsContext, type ConnectorsServices } from "./application";
import {
  countingIds,
  FakeAdapter,
  FakeBus,
  FakeTime,
  flush,
  halfRandom,
  RecordingLogger,
  shippedLinkReaders,
} from "./testing";

const config = connectorsConfig({
  woofx3MessagebusUrl: "ws://127.0.0.1:4225",
  woofx3DatabaseProxyUrl: "http://127.0.0.1:5555",
  woofx3DbProxyToken: "connectors-db-proxy-token-0123456789abcdef",
});

function setup() {
  const bus = new FakeBus();
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const application = new ConnectorsApplication({
    config,
    logger,
    adapters: { twitch: async () => ({ create: () => new FakeAdapter("twitch") }) },
    readers: shippedLinkReaders(),
    clock: time,
    random: halfRandom,
    ids: countingIds(),
    timers: time,
  });
  // The host reaches the bus only through the BusClient half of the service's client.
  const messageBus = { client: bus, isUp: () => true } as unknown as ConnectorsServices["messageBus"];
  // Answers the one db-proxy call a start makes before the settings watcher: the chat dispatcher's first listing.
  const dbProxy = {
    client: {
      baseURL: config.dbProxyUrl,
      rpcTransport: async (url: string) => {
        if (!url.endsWith("/ListCommands")) {
          throw new Error(`unexpected db-proxy call ${url}`);
        }
        const body = ListCommandsResponse.encode({ status: { code: "OK", message: "" }, commands: [] });
        // fetch's types take only ArrayBuffer-backed views.
        return new Response(new Uint8Array(body));
      },
    },
  } as unknown as ConnectorsServices["dbProxy"];
  const ctx: ConnectorsContext = { services: { messageBus, dbProxy } };
  return { bus, time, logger, application, ctx };
}

describe("ConnectorsApplication", () => {
  test("a terminate while the host starts stops it and starts no health server", async () => {
    const { bus, time, logger, application, ctx } = setup();
    await application.init();
    const release = bus.holdSubscribe(INTEGRATION_TOKEN_UPDATED_SUBJECT);
    const running = application.run(ctx);
    await flush();
    await application.terminate();
    release();
    await running;
    expect(application.isReady()).toBe(false);
    expect(logger.entries.map((entry) => entry.message)).toContain("connectors host stopped while starting");
    expect(logger.entries.map((entry) => entry.message)).not.toContain("connectors host running");
    expect(time.pending).toBe(0);
  });
});
