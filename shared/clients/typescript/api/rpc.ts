// capnweb RPC surface contracts for the engine.
//
// Types-only module — deliberately does NOT import from "capnweb" so this
// shared package stays zero-dep. Engine runtime classes (api/src/gateway.ts,
// api/src/api.ts, api/src/api-session.ts) `extends RpcTarget` for the
// capnweb side and `implements` the contracts declared here.
//
// Consumers (engine + external clients like woofx3-ui) import from
// "@woofx3/api/rpc" to describe typed capnweb stubs.

/**
 * Marker for authenticated RPC surfaces returned by `ApiGateway.authenticate()`.
 * Filled in as the shared package catches up to the engine's concrete Api
 * class — for now this is a placeholder that every method surface is
 * trivially assignable to.
 */
export interface ApiContract {}

/**
 * Payload passed to `ApiGatewayContract.registerClient`. `userId` is the
 * identity of the caller registering the client — the engine stores it so
 * the resulting client record is attributable to a user (needed for
 * per-user authorization on subsequent RPC calls).
 *
 * `callbackUrl` + `callbackToken` are the webhook target. They're optional
 * only for headless consumers (CLI tests, smoke checks) that don't need
 * to receive engine callbacks.
 */
export interface RegisterClientOptions {
  userId: string;
  callbackUrl?: string;
  callbackToken?: string;
}

/**
 * The unauthenticated capnweb entry point served by the engine. Connecting
 * to the engine's `/api` URL via capnweb HTTP batch (or WebSocket) gives
 * back a stub of this shape.
 */
export interface ApiGatewayContract {
  /** Liveness probe; used by the UI to confirm the engine is reachable. */
  ping(): Promise<{ status: string }>;

  /**
   * Register a new client (one per UI instance / caller). The engine stores
   * `callbackUrl` + `callbackToken` and uses them for every webhook callback
   * scoped to this client. `userId` attributes the registration to a known
   * user so the engine can authorize subsequent operations.
   *
   * The returned `applicationId` is the engine-side application the client
   * was scoped to (created during first-run onboarding or reused on
   * subsequent calls). The UI persists it so later RPC calls can be
   * attributed to the same application without re-resolving.
   */
  registerClient(
    description: string,
    options: RegisterClientOptions,
  ): Promise<{ clientId: string; clientSecret: string; applicationId: string }>;

  /**
   * Exchange client credentials for an authenticated API stub. The returned
   * object is a capnweb stub — methods can be called and pipelined into the
   * same HTTP batch as the `authenticate` call itself.
   */
  authenticate(clientId: string, clientSecret: string): Promise<ApiContract>;
}
