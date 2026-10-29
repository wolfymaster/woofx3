import path from "node:path";
import { createServiceLogger } from "@woofx3/common/logging";
import {
  createApplication,
  createNATSMonitor,
  createRuntime,
  installShutdown,
  loadRuntimeEnv,
} from "@woofx3/common/runtime";
import MessageBus from "@woofx3/nats";
import { ConnectorsEnvSchema, connectorsConfig } from "./config";
import { RUNTIME_HEARTBEAT_INTERVAL_MS, RUNTIME_LIVENESS_INTERVAL_MS } from "./config/host";
import { adapterRegistry } from "./host/adapters";
import ConnectorsApplication from "./host/application";
import { systemClock, systemIds, systemRandom, systemTimers } from "./host/deps";
import { linkReaders } from "./host/link-readers";
import DbProxyService from "./services/db-proxy";
import MessageBusService from "./services/message-bus";

const loaded = loadRuntimeEnv({ schema: ConnectorsEnvSchema, injectIntoProcess: true });
const config = connectorsConfig(loaded.config);

const logger = createServiceLogger({
  serviceName: "connectors",
  logDir: path.join(config.rootPath ?? process.cwd(), "logs"),
});

const bus = await MessageBus.createMessageBus({ name: "connectors", ...config.bus }, logger);

const application = new ConnectorsApplication({
  config,
  logger,
  adapters: adapterRegistry({ config, clock: systemClock, ids: systemIds, random: systemRandom, timers: systemTimers }),
  readers: linkReaders({ obsHostExplicit: config.obs.hostExplicit }),
  clock: systemClock,
  random: systemRandom,
  ids: systemIds,
  timers: systemTimers,
});

const runtime = createRuntime({
  application: createApplication(application),
  envSchema: ConnectorsEnvSchema,
  logger,
  runtimeEnv: () => loaded,
  healthMonitor: createNATSMonitor({
    natsClient: bus,
    applicationName: "connectors",
    requiredServices: ["messageBus", "dbProxy"],
    heartbeatReady: () => application.isReady(),
  }),
  heartbeatInterval: RUNTIME_HEARTBEAT_INTERVAL_MS,
  livenessInterval: RUNTIME_LIVENESS_INTERVAL_MS,
  runtimeInit: async (app) => {
    app.register("messageBus", new MessageBusService(bus, logger));
    app.register(
      "dbProxy",
      new DbProxyService(
        config.dbProxyUrl,
        config.dbProxyToken,
        config.host.dbProxyTimeoutMs,
        config.host.dbProxyHealthFailures
      )
    );
  },
});

installShutdown({
  stop: () => runtime.stop(),
  logger,
  deadlineMs: config.host.shutdownDeadlineMs,
  exit: (code) => process.exit(code),
  process,
  timers: systemTimers,
});

// Loading is idempotent, so the runtime's own init reuses these modules. A
// deadline the served budgets outgrow would make every host build throw and
// the runtime retry for ever, so refuse to start instead.
await application.init();
const deadlineProblem = application.shutdownDeadlineProblem();
if (deadlineProblem !== undefined) {
  logger.error(deadlineProblem);
  process.exit(1);
}

runtime.start();
