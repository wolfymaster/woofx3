/**
 * Service interface - wraps a client and manages its lifecycle
 * Generic type T represents the underlying client implementation
 */
export interface Service<T> {
  /**
   * Establishes connection and starts the service
   */
  connect(): Promise<void>;

  /**
   * Stops the service and disconnects
   */
  disconnect(): Promise<void>;

  /**
   * How the health monitor checks this service. The NATS monitor calls a
   * function on every health check, so it must settle within its own bound.
   * createNATSHealthCheck instead waits for a ready heartbeat from a service
   * set to `true`. `false` is never checked.
   */
  healthcheck: boolean | (() => Promise<boolean>);

  name: string;

  type: string;

  /**
   * Returns the underlying client implementation
   */
  readonly client: T;

  /**
   * Returns true if the service is currently connected/running
   */
  readonly connected: boolean;
}
