// capnweb client helpers for talking to a woofx3 engine instance.
//
// Every external consumer (woofx3-ui Convex actions today, Tauri tomorrow,
// third-party integrations later) needs the same handshake:
//   1. Open a capnweb session (HTTP batch or WebSocket) to <engineUrl>/api.
//   2. Call gateway.authenticate(clientId, clientSecret) WITHOUT awaiting.
//   3. Chain the first API call onto that pipelined promise.
//
// This module is the one place that pattern lives. Downstream callers
// type-parameterize their session with whichever `RpcCompatible<T>` surface
// they need (usually Woofx3EngineApi). Consumers never need to import from
// "capnweb" directly — RpcTarget is re-exported below so local interfaces
// can extend it without a second dependency.

import {
  RpcTarget,
  type RpcCompatible,
  newHttpBatchRpcSession,
  newWebSocketRpcSession,
} from "capnweb";
import type { ApiGatewayContract } from "./rpc";

/** Capnweb's structural RpcTarget marker, re-exported so consumers tag
 * their local interfaces without reaching into capnweb directly. */
export { RpcTarget };

/** Capnweb's structural RpcCompatible constraint, re-exported for the same
 * reason as RpcTarget. */
export type { RpcCompatible };

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
 * Normalize an instance URL to the capnweb WebSocket endpoint. Upgrades
 * http→ws / https→wss automatically and always returns `<host>/api`.
 */
export function engineWebSocketUrl(instanceUrl: string, fallbackProtocol: "ws" | "wss" = "ws"): string {
  const trimmed = instanceUrl.trim();
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return trimmed.replace(/\/?$/, "") + "/api";
  }
  if (trimmed.includes("://")) {
    const u = new URL(trimmed);
    const protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${u.host}/api`;
  }
  return `${fallbackProtocol}://${trimmed}/api`;
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

/**
 * Opaque handle returned by createEngineBrowserSession. Exposes the typed Api
 * stub plus a `dispose()` method for tearing the WebSocket down. Unlike HTTP
 * batch sessions, a WebSocket session is long-lived — call dispose() when
 * the caller (e.g. a browser tab) is done with it.
 */
export interface EngineBrowserSession<T> {
  api: T;
  gateway: ApiGatewayContract;
  dispose(): void;
}

/**
 * Open a long-lived capnweb WebSocket session. Meant for browser contexts
 * that need realtime-ish polling against the engine (chat streams, stream
 * events). The returned `api` stub stays valid across many method calls —
 * callers don't need to re-open a session per request the way HTTP batch
 * does.
 *
 * `fallbackProtocol` is used when `instanceUrl` has no scheme; defaults to
 * `ws` (appropriate for localhost / dev). Callers in secure contexts should
 * pass `wss` when uncertain.
 */
export function createEngineBrowserSession<T extends RpcCompatible<T>>(
  instanceUrl: string,
  clientId: string,
  clientSecret: string,
  fallbackProtocol: "ws" | "wss" = "ws",
): EngineBrowserSession<T> {
  const wsUrl = engineWebSocketUrl(instanceUrl, fallbackProtocol);
  const gateway = newWebSocketRpcSession<ApiGatewayContract>(wsUrl);
  const api = gateway.authenticate(clientId, clientSecret) as unknown as T;
  return {
    api,
    gateway,
    dispose() {
      (gateway as unknown as { [Symbol.dispose]?: () => void })[Symbol.dispose]?.();
    },
  };
}
