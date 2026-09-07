import type { SharedLogger } from "@woofx3/common/logging";
import type { ServerWebSocket } from "bun";
import { newHttpBatchRpcResponse, newWebSocketRpcSession } from "capnweb";
import type { ApiGateway } from "./gateway";

export interface HttpDeps {
  port: number;
  logger: SharedLogger;
  gateway: ApiGateway;
  /**
   * Records the outcome of an async barkloader job. Passed in rather
   * than reached through the gateway so the transport keeps depending
   * only on what it is handed.
   */
  onProcessingCallback: (body: unknown) => Promise<void>;
}

/**
 * Adapter to make Bun's ServerWebSocket compatible with the standard WebSocket interface
 * that capnweb expects (with addEventListener, etc.)
 */
class BunWebSocketAdapter {
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  private bunWs: ServerWebSocket<unknown>;
  private logger: SharedLogger;

  // Standard WebSocket readyState constants
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(bunWs: ServerWebSocket<unknown>, logger: SharedLogger) {
    this.bunWs = bunWs;
    this.logger = logger;
  }

  get readyState(): number {
    // Bun's ServerWebSocket is already open when we get it in the open handler
    return BunWebSocketAdapter.OPEN;
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string | ArrayBuffer): void {
    try {
      const dataStr = typeof data === "string" ? data : new TextDecoder().decode(data);
      this.logger.debug("Sending WebSocket message", {
        size: typeof data === "string" ? data.length : data.byteLength,
        preview: dataStr.substring(0, 200), // First 200 chars for preview
      });
      this.bunWs.send(data);
    } catch (error) {
      this.logger.error("Failed to send WebSocket message", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  close(code?: number, reason?: string): void {
    this.bunWs.close(code, reason);
  }

  // Called by Bun's websocket.message handler
  dispatchMessage(data: string | ArrayBuffer): void {
    try {
      const dataStr = typeof data === "string" ? data : new TextDecoder().decode(data);
      this.logger.debug("Received WebSocket message", {
        size: typeof data === "string" ? data.length : data.byteLength,
        preview: dataStr.substring(0, 200), // First 200 chars for preview
      });

      const listeners = this.listeners.get("message");
      if (listeners) {
        const event = { data };
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (error) {
            this.logger.error("Error in WebSocket message listener", {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          }
        }
      } else {
        this.logger.warn("No message listeners registered for WebSocket message");
      }
    } catch (error) {
      this.logger.error("Error dispatching WebSocket message", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // Called by Bun's websocket.close handler
  dispatchClose(code?: number, reason?: string): void {
    const listeners = this.listeners.get("close");
    if (listeners) {
      const event = { code, reason };
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  // Called by Bun's websocket.error handler
  dispatchError(error: Error): void {
    const listeners = this.listeners.get("error");
    if (listeners) {
      const event = { error };
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
}

/**
 * api's HTTP/WebSocket transport — capnweb batch-RPC over `/api`, a
 * `/health` check, and the WebSocket upgrade path via
 * `BunWebSocketAdapter`. Split out of `application.ts` so it has its
 * own seam: `deps` is everything the transport needs, nothing captured
 * ambiently, matching `sceneManager/src/http.ts`'s `createHttpServer`.
 */
export function createHttpServer(deps: HttpDeps) {
  const { port, logger, gateway, onProcessingCallback } = deps;

  // Map to track WebSocket adapters by their Bun WebSocket (capnweb path)
  const wsAdapters = new WeakMap<ServerWebSocket<unknown>, BunWebSocketAdapter>();

  return Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade
      if (url.pathname === "/api" && req.headers.get("upgrade") === "websocket") {
        logger.debug("WebSocket upgrade request", {
          path: url.pathname,
          origin: req.headers.get("origin"),
        });
        const upgraded = server.upgrade(req);
        if (!upgraded) {
          logger.error("WebSocket upgrade failed");
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return undefined;
      }

      // Handle HTTP batch requests
      if (url.pathname === "/api") {
        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          logger.debug("CORS preflight request");
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        }

        const startTime = Date.now();
        try {
          const reqBody = await req.clone().text();
          logger.info("HTTP batch RPC request", {
            method: req.method,
            path: url.pathname,
            bodyLength: reqBody.length,
            bodyPreview: reqBody.substring(0, 500),
          });
          const response = await newHttpBatchRpcResponse(req, gateway, {
            onSendError(error: Error) {
              logger.error("RPC method error", {
                error: error.message,
                stack: error.stack,
              });
              return error;
            },
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          } as any);
          const duration = Date.now() - startTime;
          const responseBody = await response.clone().text();
          logger.info("HTTP batch RPC request completed", {
            method: req.method,
            path: url.pathname,
            status: response.status,
            duration: `${duration}ms`,
            bodyLength: responseBody.length,
            bodyPreview: responseBody.substring(0, 500),
          });
          return response;
        } catch (err) {
          const duration = Date.now() - startTime;
          logger.error("RPC error", {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            method: req.method,
            path: url.pathname,
            duration: `${duration}ms`,
          });
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      // Completion callback for asynchronous barkloader work. Kept off
      // the capnweb surface because barkloader is a peer service posting
      // plain JSON, not an authenticated control-plane session.
      if (url.pathname === "/webhooks/barkloader/processing") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        try {
          const body = await req.json();
          await onProcessingCallback(body);
        } catch (err) {
          // Answer 204 regardless. barkloader treats a non-2xx as a
          // delivery failure worth logging, and there is nothing it can
          // usefully retry: the job already ran.
          logger.error("Failed to record processing callback", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return new Response(null, { status: 204 });
      }

      // Health check endpoint
      if (url.pathname === "/health") {
        logger.debug("Health check request");
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      logger.debug("Not found", { path: url.pathname, method: req.method });
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      message(ws, message) {
        const adapter = wsAdapters.get(ws);
        if (adapter) {
          adapter.dispatchMessage(typeof message === "string" ? message : message.toString());
        } else {
          logger.warn("Received WebSocket message but no adapter found", {
            messageSize: typeof message === "string" ? message.length : message.byteLength,
          });
        }
      },
      open(ws) {
        logger.info("WebSocket connection opened");
        try {
          const adapter = new BunWebSocketAdapter(ws, logger);
          wsAdapters.set(ws, adapter);
          newWebSocketRpcSession(adapter as any, gateway, {
            onSendError(error: Error) {
              logger.error("WebSocket RPC method error", {
                error: error.message,
                stack: error.stack,
              });
              return error;
            },
          });
          logger.debug("Cap'n Web RPC session initialized for WebSocket");
        } catch (error) {
          logger.error("Failed to initialize WebSocket RPC session", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      },
      close(ws, code, reason) {
        logger.info("WebSocket connection closed", { code, reason });
        const adapter = wsAdapters.get(ws);
        if (adapter) {
          adapter.dispatchClose(code, reason);
          wsAdapters.delete(ws);
        }
      },
      // Bun's WebSocketHandler has no `error` hook -- only open, message,
      // close, drain, ping and pong. An `error` handler lived here and was
      // never called, so socket failures reach the adapter through `close`
      // alone. Removed rather than left as reassuring dead code.
    },
  });
}
