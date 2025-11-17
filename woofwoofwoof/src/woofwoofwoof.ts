import path from "node:path";
import { createApplication, createNATSHealthCheck, createNATSHeartbeat, createRuntime } from "@woofx3/common/runtime";
import dotenv from "dotenv";
import WoofWoofWoof, { type WoofWoofWoofApplication } from './application';
import Bootstrap from "./boostrap";
import { Commands } from "./commands";
import BarkloaderClientService from "./services/barkloader";
import MessageBusService from "./services/messageBus";
import TwitchChatClientService from "./services/twitchChat";
import { canUse } from "./util";

export interface WoofWoofWoofRequestMessage {
  command: string;
  args: Record<string, string>;
}

dotenv.config({
  path: [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../", ".env")],
});

// boostrap the application
const appConfig = await Bootstrap();

// new Commands instance
const commander = new Commands(appConfig.channelName, appConfig.services.chatClient);

// add permissions check to commander
commander.setAuth(async (user: string, cmd: string) => {
  return await canUse(user, cmd);
});

const ctx = {
  channelName: appConfig.channelName,
  commander,
};

const runtime = createRuntime({
  application: createApplication(new WoofWoofWoof(ctx)),
  healthcheck: createNATSHealthCheck(appConfig.services.messageBus),
  heartbeat: createNATSHeartbeat(appConfig.services.messageBus, "woofwoofwoof"),
  runtimeInit: async (app: WoofWoofWoofApplication) => {
    app.register('messageBus', new MessageBusService(appConfig.services.messageBus));
    app.register('twitchChat', new TwitchChatClientService(appConfig.services.chatClient));
    app.register('barkloader', new BarkloaderClientService(appConfig.services.barkloaderClient));
  },
  runtimeTerminate: async () => {},  
});

runtime.start();

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);

  try {
    runtime.stop();
    // app.barkloaderClient.destroy();
    console.log("✅ Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during graceful shutdown:", error);
    process.exit(1);
  }
}

// graceful shutdown
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚫 Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});
