import type { RuntimeEnvResult } from "./config";
import type { Service } from "./service";

/**
 * Services registry - maps service types to service instances
 */
export type ServicesRegistry = Record<string, Service<unknown>>;

export type Logger = Pick<Console, "info" | "error" | "warn" | "debug">;

export type ApplicationContext<TContext, R extends ServicesRegistry> = TContext & {
  config: RuntimeEnvResult;
  services: R;
  logger: Logger;
};

/**
 * Application interface - provides lifecycle management and service orchestration
 */
export interface Application<TContext, TServices extends ServicesRegistry> {
  /**
   * Initialize the application
   */
  init(): Promise<void>;

  /**
   * Run the core business logic of the application
   */
  run(): Promise<void>;

  /**
   * Terminate and cleanup the application
   */
  terminate(): Promise<void>;

  /**
   * Register a service with a specific type/name.
   * type is any string; service must be one of the registry value types (TServices[keyof TServices]).
   */
  register(type: keyof TServices, service: TServices[keyof TServices]): void;

  /**
   * Access the application context
   */
  readonly context: TContext;
}

/**
 * Base application class that can be extended
 * The class constructor should receive context and store it as this.context
 * Methods receive a context object (which must have a 'services' property)
 * Only requires run(ctx) to be implemented
 *
 * @template TContextArgs - The context arguments type (with empty/untyped services)
 * @template TContext - The final context type (with typed services after registration)
 */
export interface IApplication<TContext, TServices extends ServicesRegistry> {
  readonly context: TContext;
  run(ctx: ApplicationContext<TContext, TServices>): Promise<void> | void;
  init?(ctx: ApplicationContext<TContext, TServices>): Promise<void> | void;
  terminate?(ctx: ApplicationContext<TContext, TServices>): Promise<void> | void;
}

/**
 * Creates an Application from a class instance
 * The class must have a context property and implement run(ctx), other methods are optional
 * Types are automatically inferred from the instance's generic parameters
 */
export function createApplication<
  TInstance extends IApplication<TContext, TServices>,
  TContext = TInstance extends IApplication<infer C, infer _S> ? C : never,
  TServices extends ServicesRegistry = TInstance extends IApplication<infer _C, infer S> ? S : never,
>(instance: TInstance): Application<ApplicationContext<TContext, TServices>, TServices> {
  // Validate that context exists
  if (!instance.context) {
    throw new Error("Application class must have a context property");
  }

  // Validate that run() is implemented
  if (typeof instance.run !== "function") {
    throw new Error("Application class must implement run(ctx) method");
  }

  const context = instance.context as ApplicationContext<TContext, TServices>;

  const application: Application<ApplicationContext<TContext, TServices>, TServices> = {
    /**
     * Initialize - calls the class's init(ctx) if present, otherwise no-op
     */
    async init(): Promise<void> {
      if (typeof instance.init === "function") {
        await instance.init(context);
      }
    },

    /**
     * Run - delegates to the required run(ctx) method
     */
    async run(): Promise<void> {
      await instance.run(context);
    },

    /**
     * Terminate - calls the class's terminate(ctx) if present, otherwise no-op
     */
    async terminate(): Promise<void> {
      if (typeof instance.terminate === "function") {
        await instance.terminate(context);
      }
    },

    /**
     * Register - adds a service with a specific type
     * Throws error if type already registered
     */
    register(type: string, service: TServices[keyof TServices]): void {
      const registry = context.services as ServicesRegistry;
      if (registry[type]) {
        throw new Error(`Service with type '${type}' is already registered`);
      }
      registry[type] = service;
      console.log(`Service '${type}' registered`);
    },

    /**
     * Context - returns the application context
     */
    get context(): ApplicationContext<TContext, TServices> {
      return context;
    },
  };

  return application;
}
