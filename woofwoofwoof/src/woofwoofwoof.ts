import BarkloaderClient from "@woofx3/barkloader";
import { createApplication, createNATSMonitor, createRuntime, loadRuntimeEnv } from "@woofx3/common/runtime";
import MessageBus from "@woofx3/nats";
import TwitchClient from "@woofx3/twitch";
import WoofWoofWoof, { type WoofWoofWoofApplication } from "./application";
import { WoofEnvSchema } from "./config";
import BarkloaderClientService from "./services/barkloader";
import MessageBusService from "./services/messageBus";
import TwitchChatClientService from "./services/twitchChat";

export interface WoofWoofWoofRequestMessage {
  command: string;
  args: Record<string, string>;
}

const loadedConfig = loadRuntimeEnv({
  schema: WoofEnvSchema,
  injectIntoProcess: true,
});

const bus = await MessageBus.createMessageBus({
  name: "woofwooofwoof",
  url: loadedConfig.getConfig("woofx3MessagebusUrl") as string,
  jwt: loadedConfig.getConfig("woofx3MessagebusJwt") as string,
  nkeySeed: loadedConfig.getConfig("woofx3MessagebusNKey") as string,
});
const messageBusService = new MessageBusService(bus);

const runtime = createRuntime({
  application: createApplication(new WoofWoofWoof()),
  envSchema: WoofEnvSchema,
  logger: console,
  runtimeEnv: () => loadedConfig,
  healthMonitor: createNATSMonitor({
    natsClient: bus,
    applicationName: "woofwoofwoof",
    requiredServices: ["messageBus", "barkloader"],
  }),
  runtimeInit: async (application: WoofWoofWoofApplication) => {
    const config = application.context.config;

    application.register("messageBus", messageBusService);

    const twitchClient = new TwitchClient({
      applicationId: config.getConfig("woofx3ApplicationId") as string,
      channel: config.getConfig("woofx3TwitchChannelName") as string,
      databaseURL: config.getConfig("woofx3DatabaseProxyUrl") as string,
    });
    await twitchClient.init({
      clientId: config.getConfig("woofx3TwitchClientId") as string,
      clientSecret: config.getConfig("woofx3TwitchClientSecret") as string,
      redirectUri: config.getConfig("woofx3TwitchRedirectUrl") as string,
    });
    application.register("twitchChat", new TwitchChatClientService(twitchClient.ChatClient()));

    const barkloaderWsUrl = config.getConfig("woofx3BarkloaderWsUrl") as string;
    const barkloaderToken = config.getConfig("woofx3BarkloaderKey") as string;
    const barkloaderClient = new BarkloaderClient({
      wsUrl: `${barkloaderWsUrl}?token=${barkloaderToken}`,
      onOpen: () => {
        console.log("socket opened");
      },
      onClose: () => {
        console.log("socket closed");
      },
      onError: (event: unknown) => {
        console.log("socket error", event);
      },
      maxRetries: Infinity,
      onReconnectAttempt: () => {
        console.log("disconnecting.. attempting to reconnect");
      },
      reconnectTimeout: 5000,
    });
    application.register("barkloader", new BarkloaderClientService(barkloaderClient));
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
  // Don't immediately shutdown - let the runtime handle retries
});
