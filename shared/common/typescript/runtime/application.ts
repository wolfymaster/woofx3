import type { Service } from "./service";

/**
 * Services registry - maps service types to service instances
 */
export type ServicesRegistry = Record<string, Service<unknown>>;

/**
 * Application context - passed to application methods
 * TContext must have a 'services' property of type ServicesRegistry
 */
export type ApplicationContext<TContext extends { services: ServicesRegistry }> = TContext;

/**
 * Application interface - provides lifecycle management and service orchestration
 */
export interface Application<TContext extends { services: ServicesRegistry }> {
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
   * Register a service with a specific type/name
   */
  register<K extends string>(type: K, service: Service<unknown>): void;

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
export interface ApplicationClass<
  TContextArgs extends { services: ServicesRegistry },
  TContext extends { services: ServicesRegistry } = TContextArgs
> {
  readonly context: TContextArgs;
  /** Type marker for the final context type after services are registered - used only for type inference */
  readonly __finalContextType: TContext;
  run(ctx: TContext): Promise<void> | void;
  init?(ctx: TContext): Promise<void> | void;
  terminate?(ctx: TContext): Promise<void> | void;
}

/**
 * Helper type to extract the context arguments type from an ApplicationClass
 */
type ExtractContextArgs<T> = T extends { context: infer TCtx } ? TCtx : never;

/**
 * Helper type to extract the final context type from an ApplicationClass
 * Uses the __finalContextType property for type inference
 */
type ExtractContext<T> = T extends { __finalContextType: infer TCtx }
  ? TCtx extends { services: ServicesRegistry }
    ? TCtx
    : ExtractContextArgs<T>
  : ExtractContextArgs<T>;

/**
 * Creates an Application from a class instance
 * The class must have a context property and implement run(ctx), other methods are optional
 * Types are automatically inferred from the instance's generic parameters
 */
export function createApplication<
  TInstance extends ApplicationClass<any, any>
>(
  instance: TInstance,
): Application<ExtractContext<TInstance>> {
  // Validate that context exists
  if (!instance.context) {
    throw new Error("Application class must have a context property");
  }

  // Validate that run() is implemented
  if (typeof instance.run !== "function") {
    throw new Error("Application class must implement run(ctx) method");
  }

  type TContextArgs = ExtractContextArgs<TInstance>;
  type TContext = ExtractContext<TInstance>;
  const context = instance.context as unknown as TContext;

  const application: Application<TContext> = {
    /**
     * Initialize - calls the class's init(ctx) if present, otherwise no-op
     */
    async init(): Promise<void> {
      if (typeof instance.init === "function") {
        await instance.init(context as unknown as TContextArgs);
      }
    },

    /**
     * Run - delegates to the required run(ctx) method
     */
    async run(): Promise<void> {
      await instance.run(context as unknown as TContextArgs);
    },

    /**
     * Terminate - calls the class's terminate(ctx) if present, otherwise no-op
     */
    async terminate(): Promise<void> {
      if (typeof instance.terminate === "function") {
        await instance.terminate(context as unknown as TContextArgs);
      }
    },

    /**
     * Register - adds a service with a specific type
     * Throws error if type already registered
     */
    register(type: string, service: Service<unknown>): void {
      if (context.services[type]) {
        throw new Error(`Service with type '${type}' is already registered`);
      }
      context.services[type] = service;
      console.log(`Service '${type}' registered`);
    },

    /**
     * Context - returns the application context
     */
    get context(): TContext {
      return context;
    },
  };

  return application;
}
