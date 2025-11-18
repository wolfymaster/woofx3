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

  healthcheck: boolean;

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
