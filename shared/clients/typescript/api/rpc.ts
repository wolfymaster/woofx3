// capnweb RPC surface contracts for the engine.
//
// Deliberately does NOT import from "capnweb", so this module has no
// dependencies. Engine runtime classes (api/src/gateway.ts,
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
 * Payload passed to `ApiGatewayContract.registerClient`.
 *
 * `callbackUrl` + `callbackToken` are the webhook target. They're optional
 * only for headless consumers (CLI tests, smoke checks) that don't need
 * to receive engine callbacks.
 *
 * `registrationToken` is required when the engine was deployed with
 * `WOOFX3_REGISTRATION_TOKEN` set (every managed engine is): without it
 * anyone who reaches the engine first could register and claim it. An
 * engine deployed without one ignores it. `WOOFX3_REGISTRATION_MODE` can
 * change that; see "Client registration" in docs/services/deployment.md.
 */
export interface RegisterClientOptions {
  callbackUrl?: string;
  callbackToken?: string;
  registrationToken?: string;
}

// Refusals across capnweb.
//
// capnweb sends an error's `name` and `message`, but the receiving side
// rebuilds any name it does not know as a plain `Error`, so a custom name is
// lost in transit. Each refusal is therefore carried by its message, which
// starts with the refusal's marker and ": ". A guard below reads it, both for
// the engine's own error and for the plain `Error` a capnweb client receives.

/**
 * The marker of a refused `registerClient`: this engine will not register the
 * caller. The rest of the message is written to be shown to a user.
 */
export const REGISTRATION_REFUSED = "RegistrationRefused";

/**
 * The marker of a refused `authenticate`: the engine does not accept these
 * client credentials, so retrying them cannot succeed.
 */
export const AUTHENTICATION_REFUSED = "AuthenticationRefused";

/** The message of a refused `registerClient`, for the engine to throw. */
export function registrationRefusedMessage(reason: string): string {
  return `${REGISTRATION_REFUSED}: ${reason}`;
}

/** The message of a refused `authenticate`, for the engine to throw. */
export function authenticationRefusedMessage(reason: string): string {
  return `${AUTHENTICATION_REFUSED}: ${reason}`;
}

/** Whether `err` is a refused `registerClient`, as opposed to a transport or transient failure. */
export function isRegistrationRefused(err: unknown): err is Error {
  return err instanceof Error && err.message.startsWith(`${REGISTRATION_REFUSED}: `);
}

/** Whether `err` is a refused `authenticate`, as opposed to a transport or transient failure. */
export function isAuthenticationRefused(err: unknown): err is Error {
  return err instanceof Error && err.message.startsWith(`${AUTHENTICATION_REFUSED}: `);
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
   * scoped to this client.
   *
   * `clientSecret` is returned only here; a caller that loses it must
   * register again.
   */
  registerClient(
    description: string,
    options: RegisterClientOptions
  ): Promise<{ clientId: string; clientSecret: string }>;

  /**
   * Exchange client credentials for an authenticated API stub. The returned
   * object is a capnweb stub — methods can be called and pipelined into the
   * same HTTP batch as the `authenticate` call itself.
   *
   * Rejects with an error `isAuthenticationRefused` recognises when the
   * engine does not accept the credentials.
   */
  authenticate(clientId: string, clientSecret: string): Promise<ApiContract>;
}
