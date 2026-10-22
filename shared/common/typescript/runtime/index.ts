/**
 * Runtime Framework - Main exports
 */

export type { Application, ApplicationContext, IApplication, Logger, ServicesRegistry } from "./application";
export { createApplication } from "./application";
export type { Backoff, BackoffConfig, Clock, RandomSource } from "./backoff";
export { createBackoff } from "./backoff";
export type {
  EnvConfigSchema,
  LoadRuntimeEnvOptions,
  RuntimeEnvResult,
} from "./config";
export {
  camelToScreamingSnake,
  fillEnvConfig,
  findProjectRoot,
  loadRuntimeEnv,
  screamingSnakeToCamel,
} from "./config";
export { DATA_DIR_ENV, dataDir, resolveDataPath } from "./data-dir";
export type { CreateNATSMonitorOptions } from "./monitor/nats";
export { createNATSMonitor } from "./monitor/nats";
export type {
  HealthMonitor,
  HealthMonitorService,
  RequiredServicesProvider,
  RuntimeConfig,
  RuntimeContext,
  RuntimeEvent,
} from "./runtime";
export { createRuntime, Runtime } from "./runtime";
export type { SecretProblem, SecretProblemKind, SecretResult } from "./secret";
export { MIN_SECRET_BYTES, validateSecret } from "./secret";
export type { Service } from "./service";
export type {
  ShutdownHandle,
  ShutdownOptions,
  ShutdownReason,
  ShutdownSignal,
  ShutdownTimers,
  SignalSource,
} from "./shutdown";
export { installShutdown, SHUTDOWN_SIGNALS } from "./shutdown";
export { createNATSHealthCheck, createNATSHeartbeat } from "./utils";
