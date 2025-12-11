import { type ActorRefFrom, assign, createActor, fromCallback, fromPromise, raise, setup } from "xstate";
import type { Application, ServicesRegistry } from "./application";

/**
 * Runtime configuration
 */
export interface RuntimeConfig<TContext extends { services: ServicesRegistry }> {
  application: Application<TContext>;

  runtimeInit?: (app: Application<TContext>) => Promise<void>;
  runtimeTerminate?: (app: Application<TContext>) => Promise<void>;

  heartbeat?: () => Promise<void>;
  healthcheck?: (services: TContext["services"]) => Promise<boolean>;
}

/**
 * Runtime context
 */
export interface RuntimeContext<TContext extends { services: ServicesRegistry }> {
  application: Application<TContext>;
  config: RuntimeConfig<TContext>;
  error?: Error;
  backoffDelay?: number;
}

/**
 * Runtime events
 */
export type RuntimeEvent =
  | { type: "SERVICES_READY" }
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
export function createRuntimeMachine<TContext extends { services: ServicesRegistry }>(config: RuntimeConfig<TContext>) {
  return setup({
    types: {
      context: {} as RuntimeContext<TContext>,
      events: {} as RuntimeEvent,
    },
    actors: {
      runtimeInitActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        if (input.config.runtimeInit) {
          await input.config.runtimeInit(input.application);
        }
      }),

      healthCheckActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        if (input.config.healthcheck) {
          const isHealthy = await input.config.healthcheck(input.application.context.services);
          if (!isHealthy) {
            throw new Error("Health check failed");
          }
          return isHealthy;
        }
        return true;
      }),

      heartbeatActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        if (input.config.heartbeat) {
          await input.config.heartbeat();
        }
      }),

      connectServicesActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        const services = Object.values(input.application.context.services);
        await Promise.all(services.map((service) => service.connect()));
      }),

      disconnectServicesActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        const services = Object.values(input.application.context.services);
        await Promise.all(services.map((service) => service.disconnect()));
      }),

      applicationInitActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        await input.application.init();
      }),

      applicationRunActor: fromCallback(
        ({ input, sendBack }: { input: RuntimeContext<TContext>; sendBack: (evt: RuntimeEvent) => void }) => {
          input.application.run();
        }
      ),

      applicationTerminateActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        await input.application.terminate();
      }),

      runtimeTerminateActor: fromPromise(async ({ input }: { input: RuntimeContext<TContext> }) => {
        if (input.config.runtimeTerminate) {
          await input.config.runtimeTerminate(input.application);
        }
      }),
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
      backoffDelay: 1000, // Initial backoff: 1 second
    },
    states: {
      runtime_init: {
        invoke: {
          src: "runtimeInitActor",
          input: ({ context }) => context,
          onDone: {
            target: "health_heartbeat",
          },
          onError: {
            target: "runtime_terminating",
            actions: ({ event }) => {
              console.error("Runtime init failed:", event.error);
            },
          },
        },
      },

      health_heartbeat: {
        invoke: [
          {
            src: "heartbeatActor",
            input: ({ context }) => context,
            onError: {
              target: "health_heartbeat_waiting",
              actions: [
                assign({
                  backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay),
                }),
              ],
            },
          },
          {
            src: "healthCheckActor",
            input: ({ context }) => context,
            onDone: {
              target: "services_connect",
              actions: assign({
                backoffDelay: () => 1000, // Reset backoff on success
              }),
            },
            onError: {
              target: "health_heartbeat_waiting",
              actions: [
                assign({
                  backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay),
                }),
              ],
            },
          },
        ],
      },

      health_heartbeat_waiting: {
        after: {
          BACKOFF_DELAY: {
            target: "health_heartbeat",
          },
        },
        entry: ({ context }) => {
          console.log(`Waiting ${context.backoffDelay}ms before retrying health check...`);
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
            target: "health_heartbeat_waiting",
            actions: [
              ({ event }) => {
                console.error("Service connection failed:", event.error);
              },
              assign({
                backoffDelay: ({ context }) => calculateNextBackoffDelay(context.backoffDelay),
              }),
            ],
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
                    target: "application_terminating",
                    actions: ({ event }) => {
                      console.error("Application init failed:", event.error);
                    },
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
                },
              },

              application_terminating: {
                invoke: {
                  src: "applicationTerminateActor",
                  input: ({ context }) => context,
                  onDone: {
                    actions: [
                      () => {
                        console.log("Application terminated");
                      },
                      raise({ type: "SHUTDOWN" }),
                    ],
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
                on: {
                  HEALTH_CHECK_FAILED: {
                    target: "#runtime.health_heartbeat",
                  },
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
              src: "disconnectServicesActor",
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
export class Runtime<TContext extends { services: ServicesRegistry }> {
  private actor: ActorRefFrom<ReturnType<typeof createRuntimeMachine<TContext>>>;

  constructor(config: RuntimeConfig<TContext>) {
    const machine = createRuntimeMachine(config);
    this.actor = createActor(machine);
  }

  start() {
    this.actor.start();
    return this;
  }

  async stop() {
    this.actor.send({ type: "SHUTDOWN" });
    await this.waitForEvent('done');
  }

  getState() {
    return this.actor.getSnapshot();
  }

  subscribe(callback: (state: any) => void) {
    return this.actor.subscribe(callback);
  }

  private waitForEvent(event: string) {
    return new Promise<void>((resolve) => {
      const subscription = this.actor.subscribe((snapshot) => {
        // Check if we've reached the final state
        if (snapshot.status === event) {
          subscription.unsubscribe();
          resolve();
        }
      });
    });
  }
}

export function createRuntime<TContext extends { services: ServicesRegistry }>(
  config: RuntimeConfig<TContext>
): Runtime<TContext> {
  return new Runtime(config);
}
