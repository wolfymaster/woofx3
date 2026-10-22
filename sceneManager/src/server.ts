import { createServiceLogger } from "@woofx3/common/logging";
import { createApplication, createRuntime, loadRuntimeEnv } from "@woofx3/common/runtime";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";
import SceneManager, { type SceneManagerApplication } from "./application";
import { loadConfig, SceneManagerEnvSchema, validateConfig } from "./config";
import DatabaseService from "./services/db";

const runtimeConfig = loadConfig();
validateConfig(runtimeConfig);

const loadedConfig = loadRuntimeEnv({
  schema: SceneManagerEnvSchema,
  injectIntoProcess: true,
});

const logger = createServiceLogger({
  serviceName: "scene-manager",
  logDir: `${runtimeConfig.rootDir}/logs`,
});

const runtime = createRuntime({
  application: createApplication(new SceneManager(runtimeConfig)),
  envSchema: SceneManagerEnvSchema,
  logger,
  runtimeEnv: () => loadedConfig,
  runtimeInit: async (application: SceneManagerApplication) => {
    application.register(
      "db",
      new DatabaseService(dbProxyClientConfig(runtimeConfig.databaseProxyUrl, runtimeConfig.dbProxyToken))
    );
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
// The orchestrator's stop request on Windows (CTRL_BREAK_EVENT). Never raised elsewhere.
process.on("SIGBREAK", () => gracefulShutdown("SIGBREAK"));
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", { error: error.message, stack: error.stack });
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
