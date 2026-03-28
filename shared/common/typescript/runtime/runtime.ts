import { type ActorRefFrom, assign, createActor, fromCallback, fromPromise, raise, setup } from "xstate";
import type { Application, ServicesRegistry } from "./application";
import {
  type EnvConfigSchema,
  fillEnvConfig,
  type LoadRuntimeEnvOptions,
  loadRuntimeEnv,
  type RuntimeEnvResult,
} from "./config";

/**
 * Health monitor: runtime calls Liveness periodically, starts via Start(), and drives Heartbeat and HealthCheck on an interval.
 */
export interface HealthMonitor {
  liveness(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  heartbeat(): Promise<void>;
  healthCheck(services: ServicesRegistry): Promise<boolean>;
}

/** Optional: if a HealthMonitor implements this, the runtime connects these services before calling start(). */
export interface RequiredServicesProvider {
  requiredServices(): string[];
}

/** Optional: HealthMonitor that is also a Service; runtime will connect it before start() and disconnect() after stop(). */
export interface HealthMonitorService extends HealthMonitor {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly name: string;
  readonly type: string;
}

function isHealthMonitorService(m: HealthMonitor): m is HealthMonitorService {
  return "connect" in m && "disconnect" in m && "name" in m && "type" in m;
}
function isRequiredServicesProvider(m: HealthMonitor): m is HealthMonitor & RequiredServicesProvider {
  return typeof (m as HealthMonitor & RequiredServicesProvider).requiredServices === "function";
}

export type { EnvConfigSchema };

/**
 * Runtime configuration
 */
export interface RuntimeConfig<TContext extends { services: ServicesRegistry }, TServices extends ServicesRegistry> {
  application: Application<TContext, TServices>;

  runtimeInit?: (app: Application<TContext, TServices>) => Promise<void>;
  runtimeTerminate?: (app: Application<TContext, TServices>) => Promise<void>;

  /** Health monitor. When set, runtime uses health_monitor_init -> health_monitor_ready -> services_connect flow. */
  healthMonitor?: HealthMonitor;

  /** Logger; defaults to console. */
  logger?: Pick<Console, "info" | "error" | "warn" | "debug">;

  /** Project root for loading .woofx3.json and .env. Defaults to findProjectRoot(). */
  rootDir?: string;

  /**
   * Schema that the resolved config must match exactly. The runtime loads config file then env,
   * merges (file overrides env), coerces to a common format, then validates. Application only sees schema-shaped config.
   */
  envSchema: EnvConfigSchema;

  /**
   * Optional: custom env loading. If not set, loadRuntimeEnv({ rootDir }) is used.
   * Use injectIntoProcess: true to also set process.env.
   */
  runtimeEnv?: LoadRuntimeEnvOptions | (() => RuntimeEnvResult | Promise<RuntimeEnvResult>);

  /**
   * Optional: initial backoff delay in ms (used for testing with fast retries). Default 1000.
   */
  initialBackoffMs?: number;
}

/**
 * Runtime context
 */
export interface ServiceConnectionState {
  connected: boolean;
  error?: Error;
}

export interface RuntimeContext<TContext extends { services: ServicesRegistry }, TServices extends ServicesRegistry> {
  application: Application<TContext, TServices>;
  config: RuntimeConfig<TContext, TServices>;
  error?: Error;
  backoffDelay?: number;
  serviceStates: Record<string, ServiceConnectionState>;
}

/**
 * Runtime events
 */
export type RuntimeEvent =
  | { type: "SERVICES_READY" }
  | { type: "HEALTH_MONITOR_READY" }
  | { type: "HEALTH_MONITOR_FAILED" }
  | { type: "HEALTH_CHECK_FAILED" }
  | { type: "HEALTH_CHECK_PASSED" }
  | { type: "SERVICES_CONNECTED" }
  | { type: "APPLICATION_STARTED" }
  | { type: "APPLICATION_TERMINATED" }
  | { type: "SHUTDOWN" }
  | { type: "RESTART_APPLICATION" }
  | { type: "ERROR"; error: Error };

/**
 * Calculate the next exponential backoff delay.
 * Doubles the current delay, but resets to 1000ms if it would exceed 60000ms (1 minute).
 */
function calculateNextBackoffDelay(currentDelay: number | undefined): number {
  const nextDelay = (currentDelay || 1000) * 2;
  // Reset if it would exceed 1 minute
  return nextDelay > 60000 ? 1000 : nextDelay;
}

/**
 * Create the runtime state machine
 */
export function createRuntimeMachine<
  TContext extends { services: ServicesRegistry },
  TServices extends ServicesRegistry,
>(config: RuntimeConfig<TContext, TServices>) {
  return setup({
    types: {
      context: {} as RuntimeContext<TContext, TServices>,
      events: {} as RuntimeEvent,
    },
    actors: {
      runtimeInitActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        const app = input.application;
        const ctx = app.context as Record<string, unknown>;
        const rootDir = input.config.rootDir;
        const envSchema = input.config.envSchema;
        let result: RuntimeEnvResult;
        if (input.config.runtimeEnv != null && typeof input.config.runtimeEnv === "function") {
          const customResult = await Promise.resolve(input.config.runtimeEnv());
          const validated = fillEnvConfig(envSchema as import("zod").ZodType, customResult.config) as Record<
            string,
            string | number | boolean
          >;
          result = {
            config: validated,
            getConfig: (key: string) => validated[key],
          };
        } else {
          result = loadRuntimeEnv({
            ...(typeof input.config.runtimeEnv === "object" ? input.config.runtimeEnv : {}),
            rootDir,
            schema: envSchema,
          });
        }
        ctx.config = result;
        ctx.logger = input.config.logger ?? console;
        ctx.services = ctx.services && typeof ctx.services === "object" ? ctx.services : {};
        if (input.config.runtimeInit) {
          await input.config.runtimeInit(input.application);
        }
      }),

      healthMonitorInitActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        const monitor = input.config.healthMonitor;
        if (!monitor) return "ready";
        const app = input.application;
        const services = app.context.services;
        if (isRequiredServicesProvider(monitor)) {
          for (const name of monitor.requiredServices()) {
            const svc = services[name];
            if (!svc) throw new Error(`Health monitor required service not registered: ${name}`);
            try {
              await svc.connect();
              input.serviceStates[name] = { connected: true };
            } catch (e) {
              input.serviceStates[name] = { connected: false, error: e as Error };
              throw e;
            }
          }
        }
        if (isHealthMonitorService(monitor)) {
          await monitor.connect();
        }
        await monitor.start();
        return "ready";
      }),

      connectServicesActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        const services = Object.values(input.application.context.services);
        await Promise.all(
          services.map(async (service) => {
            const name = service.name;
            // Skip if already connected and tracked
            if (input.serviceStates[name]?.connected) {
              console.log(`Service ${name} already connected, skipping`);
              return;
            }
            try {
              await service.connect();
              input.serviceStates[name] = { connected: true };
            } catch (e) {
              input.serviceStates[name] = { connected: false, error: e as Error };
              throw e;
            }
          })
        );
      }),

      disconnectServicesActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        const services = Object.values(input.application.context.services);
        const results = await Promise.allSettled(services.map((service) => service.disconnect()));
        // Update all service states to disconnected
        for (const service of services) {
          const name = service.name;
          const result = results.find((_, i) => services[i].name === name);
          if (result?.status === "fulfilled") {
            input.serviceStates[name] = { connected: false };
          } else {
            input.serviceStates[name] = {
              connected: false,
              error: result?.status === "rejected" ? ((result as PromiseRejectedResult).reason as Error) : undefined,
            };
          }
        }
      }),

      applicationInitActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        await input.application.init();
      }),

      applicationRunActor: fromCallback(
        ({
          input,
          sendBack,
        }: {
          input: RuntimeContext<TContext, TServices>;
          sendBack: (evt: RuntimeEvent) => void;
        }) => {
          input.application.run().catch((err) => {
            console.error("Application run failed:", err);
            sendBack({ type: "ERROR", error: err });
          });
        }
      ),

      applicationTerminateActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        await input.application.terminate();
      }),

      runtimeTerminateActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
        if (input.config.runtimeTerminate) {
          await input.config.runtimeTerminate(input.application);
        }
      }),

      stopHealthMonitorAndDisconnectActor: fromPromise(
        async ({ input }: { input: RuntimeContext<TContext, TServices> }) => {
          try {
            if (input.config.healthMonitor) {
              await input.config.healthMonitor.stop();
            }
          } catch (e) {
            console.warn("Error stopping health monitor:", e);
          }
          const services = Object.values(input.application.context.services);
          const disconnectResults = await Promise.allSettled(services.map((s) => s.disconnect()));
          for (const result of disconnectResults) {
            if (result.status === "rejected") {
              console.warn("Error disconnecting service:", result.reason);
            }
          }
          // Reset all service states to disconnected
          for (const service of services) {
            input.serviceStates[service.name] = { connected: false };
          }
        }
      ),

      healthMonitorLoopsActor: fromCallback(
        ({
          input,
          sendBack,
        }: {
          input: RuntimeContext<TContext, TServices>;
          sendBack: (evt: RuntimeEvent) => void;
        }) => {
          const monitor = input.config.healthMonitor;
          if (!monitor) return;
          const livenessId = setInterval(() => {
            monitor.liveness().catch(() => sendBack({ type: "HEALTH_MONITOR_FAILED" }));
          }, 3000);
          const heartbeatId = setInterval(() => {
            monitor.heartbeat().catch(() => {});
          }, 5000);
          const healthId = setInterval(() => {
            monitor
              .healthCheck(input.application.context.services)
              .then((ok) => {
                if (!ok) sendBack({ type: "HEALTH_CHECK_FAILED" });
              })
              .catch(() => sendBack({ type: "HEALTH_CHECK_FAILED" }));
          }, 5000);
          return () => {
            clearInterval(livenessId);
            clearInterval(heartbeatId);
            clearInterval(healthId);
          };
        }
      ),
    },
    delays: {
      BACKOFF_DELAY: ({ context }) => context.backoffDelay || 1000,
    },
  }).createMachine({
    id: "runtime",
    initial: "runtime_init",
    context: {
      application: config.application,
      config,
      backoffDelay: config.initialBackoffMs ?? 1000,
      serviceStates: {},
    },
    on: {
      SHUTDOWN: {
        target: ".runtime_terminating",
      },
      HEALTH_MONITOR_FAILED: {
        target: ".health_failure_disconnecting",
      },
      HEALTH_CHECK_FAILED: {
        target: ".health_failure_disconnecting",
      },
    },
    states: {
      runtime_init: {
        invoke: {
          src: "runtimeInitActor",
          input: ({ context }) => context,
          onDone: {
            target: "health_monitor_init",
          },
          onError: {
            target: "runtime_terminating",
            actions: ({ event }) => {
              console.error("Runtime init failed:", event.error);
            },
          },
        },
      },

      health_monitor_init: {
        invoke: {
          src: "healthMonitorInitActor",
          input: ({ context }) => context,
          onDone: {
            target: "health_monitor_ready",
          },
          onError: {
            target: "health_monitor_waiting",
            actions: [
              ({ event }) => console.error("Health monitor init failed:", event.error),
              assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
            ],
          },
        },
      },

      health_monitor_ready: {
        always: {
          target: "services_connect",
        },
      },

      health_monitor_waiting: {
        after: {
          BACKOFF_DELAY: {
            target: "health_monitor_init",
          },
        },
        entry: ({ context }) => {
          console.log(`Waiting ${context.backoffDelay}ms before retrying health monitor...`);
        },
      },

      services_connect: {
        invoke: {
          src: "connectServicesActor",
          input: ({ context }) => context,
          onDone: {
            target: "services_connected",
          },
          onError: {
            target: "health_monitor_waiting",
            actions: [
              ({ event }) => console.error("Service connection failed:", event.error),
              assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
            ],
          },
        },
        on: {
          HEALTH_MONITOR_FAILED: { target: "health_failure_disconnecting" },
          HEALTH_CHECK_FAILED: { target: "health_failure_disconnecting" },
        },
      },

      health_failure_disconnecting: {
        invoke: {
          src: "stopHealthMonitorAndDisconnectActor",
          input: ({ context }) => context,
          onDone: {
            target: "health_monitor_waiting",
            actions: assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
          },
          onError: {
            target: "health_monitor_waiting",
            actions: assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
          },
        },
      },

      services_connected: {
        type: "parallel",
        states: {
          application: {
            initial: "application_init",
            states: {
              application_init: {
                invoke: {
                  src: "applicationInitActor",
                  input: ({ context }) => context,
                  onDone: {
                    target: "application_running",
                  },
                  onError: {
                    target: "application_restart_waiting",
                    actions: [
                      ({ event }) => console.error("Application init failed, retrying:", event.error),
                      assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
                    ],
                  },
                },
                after: {
                  // Timeout for application init - retry after backoff
                  30000: {
                    target: "application_restart_waiting",
                    actions: [
                      () => console.error("Application init timed out, retrying..."),
                      assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
                    ],
                  },
                },
              },

              application_running: {
                invoke: {
                  src: "applicationRunActor",
                  input: ({ context }) => context,
                },
                on: {
                  SHUTDOWN: {
                    target: "application_terminating",
                  },
                  ERROR: {
                    target: "application_restart_waiting",
                    actions: [
                      ({ event }) => console.error("Application run error, restarting:", (event as { error: Error }).error),
                      assign({ backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay) }),
                    ],
                  },
                },
              },

              application_restart_waiting: {
                after: {
                  BACKOFF_DELAY: {
                    target: "application_init",
                  },
                },
                entry: ({ context }) => {
                  console.log(`Waiting ${context.backoffDelay}ms before restarting application...`);
                },
              },

              application_terminating: {
                invoke: {
                  src: "applicationTerminateActor",
                  input: ({ context }) => context,
                  onDone: {
                    actions: [() => console.log("Application terminated"), raise({ type: "SHUTDOWN" })],
                  },
                },
                on: {
                  RESTART_APPLICATION: {
                    target: "application_init",
                  },
                },
              },
            },
          },

          healthMonitor: {
            initial: "monitoring",
            states: {
              monitoring: {
                invoke: {
                  src: "healthMonitorLoopsActor",
                  input: ({ context }) => context,
                },
                on: {
                  HEALTH_MONITOR_FAILED: { target: "#runtime.health_failure_disconnecting" },
                  HEALTH_CHECK_FAILED: { target: "#runtime.health_failure_disconnecting" },
                },
              },
            },
          },
        },
        on: {
          SHUTDOWN: {
            target: "runtime_terminating",
          },
        },
      },

      runtime_terminating: {
        initial: "disconnecting_services",
        states: {
          disconnecting_services: {
            invoke: {
              id: "disconnectServices",
              src: "stopHealthMonitorAndDisconnectActor",
              input: ({ context }) => context,
              onDone: {
                target: "terminating_runtime",
              },
              onError: {
                target: "terminating_runtime",
                actions: ({ event }) => {
                  console.error("Service disconnect failed:", event.error);
                },
              },
            },
          },
          terminating_runtime: {
            invoke: {
              id: "runtimeTerminate",
              src: "runtimeTerminateActor",
              input: ({ context }) => context,
              onDone: {
                target: "#runtime.terminated",
              },
              onError: {
                target: "#runtime.terminated",
                actions: ({ event }) => {
                  console.error("Runtime terminate failed:", event.error);
                },
              },
            },
          },
        },
      },

      terminated: {
        type: "final",
      },
    },
  });
}

/**
 * Runtime class to manage the runtime lifecycle
 */
export class Runtime<TContext extends { services: ServicesRegistry }, TServices extends ServicesRegistry> {
  private actor: ActorRefFrom<ReturnType<typeof createRuntimeMachine<TContext, TServices>>>;

  constructor(config: RuntimeConfig<TContext, TServices>) {
    const machine = createRuntimeMachine(config);
    this.actor = createActor(machine);
  }

  start() {
    this.actor.start();
    return this;
  }

  async stop() {
    const currentStatus = this.actor.getSnapshot().status;
    if (currentStatus === "done") {
      return;
    }
    this.actor.send({ type: "SHUTDOWN" });
    await this.waitForEvent("done");
  }

  getState() {
    return this.actor.getSnapshot();
  }

  subscribe(callback: (state: unknown) => void) {
    return this.actor.subscribe(callback);
  }

  private waitForEvent(event: string, timeoutMs: number = 10000) {
    return new Promise<void>((resolve) => {
      const subscription = this.actor.subscribe((snapshot) => {
        if (snapshot.status === event) {
          subscription.unsubscribe();
          resolve();
        }
      });
      setTimeout(() => {
        subscription.unsubscribe();
        console.warn(`waitForEvent timed out after ${timeoutMs}ms, forcing shutdown`);
        resolve();
      }, timeoutMs);
    });
  }
}

export function createRuntime<TContext extends { services: ServicesRegistry }, TServices extends ServicesRegistry>(
  config: RuntimeConfig<TContext, TServices>
): Runtime<TContext, TServices> {
  return new Runtime(config);
}
