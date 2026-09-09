import path from "node:path";
import { createServiceLogger } from "@woofx3/common/logging";
import { createApplication, createNATSMonitor, createRuntime, loadRuntimeEnv } from "@woofx3/common/runtime";
import MessageBus from "@woofx3/nats";
import Application, { type TwitchApiApplication } from "./application";
import { TwitchEnvSchema } from "./config";
import DbProxyService from "./services/dbProxy";
import MessageBusService from "./services/messageBus";

const loadedConfig = loadRuntimeEnv({
  schema: TwitchEnvSchema,
  injectIntoProcess: true,
});

const bus = await MessageBus.createMessageBus({
  name: "twitchapi",
  url: loadedConfig.getConfig("woofx3MessagebusUrl") as string,
  jwt: loadedConfig.getConfig("woofx3MessagebusJwt") as string,
  nkeySeed: loadedConfig.getConfig("woofx3MessagebusNKey") as string,
});
const logger = createServiceLogger({
  serviceName: "twitch",
  logDir: path.join((loadedConfig.getConfig("woofx3RootPath") as string | undefined) ?? process.cwd(), "logs"),
});

const application = new Application();

const runtime = createRuntime({
  application: createApplication(application),
  envSchema: TwitchEnvSchema,
  logger,
  runtimeEnv: () => loadedConfig,
  healthMonitor: createNATSMonitor({
    natsClient: bus,
    applicationName: "twitchapi",
    requiredServices: ["messageBus", "dbProxy"],
    // Without this the monitor defaults `ready` to false forever; with it
    // the heartbeat tells the rest of the system whether Twitch events are
    // actually flowing, and flips to true on its own if Twurple's retries
    // establish the subscriptions later.
    heartbeatReady: () => application.isEventBusReady(),
  }),
  heartbeatInterval: 250_000,
  livenessInterval: 300_000,
  runtimeInit: async (app: TwitchApiApplication) => {
    app.register("messageBus", new MessageBusService(bus));
    app.register("dbProxy", new DbProxyService(loadedConfig.getConfig("woofx3DatabaseProxyUrl") as string));
  },
  runtimeTerminate: async () => {},
});

runtime.start();

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, starting graceful shutdown...`);

  try {
    await runtime.stop();
    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
