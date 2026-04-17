// capnweb client helpers for talking to a woofx3 engine instance.
//
// Every external consumer (woofx3-ui Convex actions today, Tauri tomorrow,
// third-party integrations later) needs the same handshake:
//   1. Open a capnweb HTTP batch session to <engineUrl>/api.
//   2. Call gateway.authenticate(clientId, clientSecret) WITHOUT awaiting.
//   3. Chain the first API call onto that pipelined promise so both land
//      in a single HTTP batch.
//
// This module is the one place that pattern lives. Downstream callers
// type-parameterize their session with whichever `RpcCompatible<T>` surface
// they need (usually the shared EngineApi / Woofx3EngineApi).

import { type RpcCompatible, newHttpBatchRpcSession } from "capnweb";
import type { ApiGatewayContract } from "./rpc";

/**
 * Normalize a user-configured instance URL to the capnweb HTTP batch endpoint.
 * Accepts `localhost:8080`, `http://host`, or `https://host` — always returns
 * `<origin>/api`.
 */
export function engineApiUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const u = new URL(trimmed);
    return `${u.origin}/api`;
  }
  return `http://${trimmed}/api`;
}

/**
 * Open an unauthenticated capnweb Gateway session for a given engine URL.
 * Only `ping()` and `registerClient()` are safe to call before authenticate.
 */
export function createEngineGatewaySession(instanceUrl: string): ApiGatewayContract {
  const url = engineApiUrl(instanceUrl);
  return newHttpBatchRpcSession<ApiGatewayContract>(url);
}

/**
 * Open an authenticated capnweb RPC session for a given engine URL.
 *
 * Connects to the Gateway and calls `authenticate(clientId, clientSecret)` to
 * get back an Api stub. The authenticate call is NOT awaited — it is
 * pipelined with the caller's next API call into a single HTTP batch request.
 *
 * IMPORTANT (capnweb HTTP batch constraint): With `newHttpBatchRpcSession`,
 * the entire batch is sent on the FIRST await. After that await the session
 * is consumed. This means:
 *   - Do NOT await the return value of this function before calling an API method.
 *   - Chain the API call directly:
 *       const result = await createEngineSession(url, id, secret).someMethod();
 *   - Multiple API calls require separate sessions (one per batch).
 *
 * Type parameter `T` is the caller-chosen Api surface. Most consumers pass
 * `Woofx3EngineApi` (from "@woofx3/api") — or a local intersection that
 * extends it — to get typed results on every method call.
 */
export function createEngineSession<T extends RpcCompatible<T>>(
  instanceUrl: string,
  clientId: string,
  clientSecret: string,
): T {
  const gateway = createEngineGatewaySession(instanceUrl);
  // Not awaited — pipelined into the same HTTP batch as the caller's API call.
  return gateway.authenticate(clientId, clientSecret) as unknown as T;
}
