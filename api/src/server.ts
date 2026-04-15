import { createMessageBus } from "@woofx3/nats";
import type { ServerWebSocket } from "bun";
import { newHttpBatchRpcResponse, newWebSocketRpcSession } from "capnweb";
import type { Logger } from "winston";
import { Api } from "./api";
import { ClientAuth } from "./auth";
import { loadConfig } from "./config";
import { DbClient } from "./db-client";
import { ApiGateway } from "./gateway";
import { makeLogger } from "./logger";

/**
 * Adapter to make Bun's ServerWebSocket compatible with the standard WebSocket interface
 * that capnweb expects (with addEventListener, etc.)
 */
class BunWebSocketAdapter {
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  private bunWs: ServerWebSocket<unknown>;
  private logger: Logger;

  // Standard WebSocket readyState constants
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(bunWs: ServerWebSocket<unknown>, logger: Logger) {
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

// Map to track WebSocket adapters by their Bun WebSocket
const wsAdapters = new WeakMap<ServerWebSocket<unknown>, BunWebSocketAdapter>();

async function main() {
  // Initialize logger first
  const logger = makeLogger({
    level: process.env.LOG_LEVEL || "info",
    defaultMeta: { service: "api" },
  });

  const config = loadConfig();

  logger.info("Starting API server", {
    port: config.port || 8080,
    applicationId: config.applicationId,
  });

  // Initialize DB client
  logger.info("Initializing DB client", { url: config.databaseProxyUrl });
  const dbClient = new DbClient(config.databaseProxyUrl);

  // Initialize NATS client (optional for dev mode)
  let natsClient: Awaited<ReturnType<typeof createMessageBus>> | null = null;
  try {
    logger.info("Connecting to NATS", { url: config.nats.url, name: config.nats.name });
    natsClient = await createMessageBus(config.nats, logger);
    await natsClient.connect();
    logger.info("Connected to NATS");
  } catch (err) {
    logger.warn("Failed to connect to NATS", { error: err });
    logger.warn("Running in offline mode - some features may be unavailable");
  }

  // Create API instance
  const api = new Api({
    db: dbClient,
    nats: natsClient,
    applicationId: config.applicationId,
    barkloaderUrl: config.barkloaderUrl,
    logger,
  });
  await api.initSubscriptions();

  // Create auth and gateway
  const auth = new ClientAuth(dbClient, logger);
  api.setAuthInvalidate(() => auth.invalidateCache());
  const gateway = new ApiGateway(api, auth, dbClient, config.applicationId, logger);

  // Create HTTP server
  Bun.serve({
    port: config.port,
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
        // Forward message to the adapter which dispatches to capnweb
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
        // Create adapter and initialize capnweb session
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
      error(ws, error) {
        logger.error("WebSocket error", { error: error.message, stack: error.stack });
        const adapter = wsAdapters.get(ws);
        if (adapter) {
          adapter.dispatchError(error);
        }
      },
    },
  });

  logger.info("API server started", {
    port: config.port,
    httpEndpoint: `http://localhost:${config.port}/api`,
    wsEndpoint: `ws://localhost:${config.port}/api`,
    healthEndpoint: `http://localhost:${config.port}/health`,
  });
}

main().catch((err) => {
  const logger = makeLogger({ level: "error" });
  logger.error("Failed to start server", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
