import { createServiceLogger } from "@woofx3/common/logging";
import { createApplication, createRuntime, loadRuntimeEnv } from "@woofx3/common/runtime";
import ApiApplication, { type ApiApplicationHandle } from "./application";
import { ApiEnvSchema, loadConfig } from "./config";
import DbService from "./db-service";

const runtimeConfig = loadConfig();

const loadedConfig = loadRuntimeEnv({
  schema: ApiEnvSchema,
  injectIntoProcess: true,
});

const logger = createServiceLogger({
  serviceName: "api",
  logDir: `${runtimeConfig.rootDir}/logs`,
});

const runtime = createRuntime({
  application: createApplication(new ApiApplication(runtimeConfig)),
  envSchema: ApiEnvSchema,
  logger,
  runtimeEnv: () => loadedConfig,
  runtimeInit: async (application: ApiApplicationHandle) => {
    application.register("db", new DbService(runtimeConfig.databaseProxyUrl));
  },
  runtimeTerminate: async () => {},
});

runtime.start();

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  try {
    await runtime.stop();
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during graceful shutdown", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", { error: error.message, stack: error.stack });
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});
