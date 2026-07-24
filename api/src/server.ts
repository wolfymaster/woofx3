import { createServiceLogger, type SharedLogger } from "@woofx3/common/logging";
import { createMessageBus } from "@woofx3/nats";
import type { ServerWebSocket } from "bun";
import { newHttpBatchRpcResponse, newWebSocketRpcSession } from "capnweb";
import { AlertEmitter } from "./alert-emitter";
import { Api } from "./api";
import { ClientAuth } from "./auth";
import { loadConfig } from "./config";
import { ConvexWebhookClient } from "./convex-webhook-client";
import { DbClient } from "./db-client";
import { ApiGateway } from "./gateway";
import { initOverlayTokenHandlers } from "./overlay-token-handlers";
import { parseOverlayWsPath, proxyRequest } from "./overlay-proxy";
import { StorageChangeEmitter } from "./storage-change-emitter";
import { WebhookClient } from "./webhook-client";

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

// Map to track WebSocket adapters by their Bun WebSocket (capnweb path)
const wsAdapters = new WeakMap<ServerWebSocket<unknown>, BunWebSocketAdapter>();

// Map to track upstream WebSocket connections for overlay pump sessions
const overlayUpstreams = new WeakMap<ServerWebSocket<unknown>, WebSocket>();

interface OverlayPumpData {
  kind: "overlay-pump";
  upstreamUrl: string;
  token: string;
}

async function main() {
  const config = loadConfig();

  // Initialize logger first
  const logger = createServiceLogger({
    serviceName: "api",
    logDir: `${config.rootDir}/logs`,
  });

  logger.info("Starting API server", { port: config.port || 8080 });

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
    natsClient = null;
  }

  const api = new Api({
    db: dbClient,
    nats: natsClient,
    barkloaderUrl: config.barkloaderUrl,
    streamwareUrl: config.streamwareUrl,
    overlayPublicUrl: config.overlayPublicUrl,
    logger,
  });

  const webhookClient = new WebhookClient(dbClient, logger, null);
  api.setWebhookClient(webhookClient);

  let convexWebhookClient: ConvexWebhookClient | null = null;
  let alertEmitter: AlertEmitter | null = null;
  let storageChangeEmitter: StorageChangeEmitter | null = null;

  try {
    const existing = await dbClient.getDefaultApplication();
    if (existing) {
      api.setApplicationId(existing.id);
      await webhookClient.refreshCallbackUrls();
      logger.info("Warmed applicationId cache from existing default", { applicationId: existing.id });

      convexWebhookClient = new ConvexWebhookClient({
        db: dbClient,
        logger,
        applicationId: existing.id,
      });
      await convexWebhookClient.loadConfig();

      if (natsClient) {
        alertEmitter = new AlertEmitter(natsClient, convexWebhookClient, existing.id, logger);
        await alertEmitter.start();

        storageChangeEmitter = new StorageChangeEmitter(natsClient, webhookClient, logger);
        await storageChangeEmitter.start();
      } else {
        logger.warn("Skipping AlertEmitter and StorageChangeEmitter; NATS client is not connected");
      }
    } else {
      logger.info("No default application yet; waiting for UI onboarding");
    }
  } catch (err) {
    logger.warn("Default-application warmup failed (continuing)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await api.initSubscriptions();

  if (natsClient) {
    await initOverlayTokenHandlers(natsClient, webhookClient, logger);
  }

  const auth = new ClientAuth(dbClient, logger);
  api.setAuthInvalidate(() => auth.invalidateCache());
  const gateway = new ApiGateway(api, auth, dbClient, logger);
  gateway.setWebhookClient(webhookClient);

  // Create HTTP server
  Bun.serve({
    port: config.port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Overlay proxy — dumb byte-level forward for /overlay/** paths.
      // WebSocket upgrade for /overlay/{token}/events is handled first;
      // all other /overlay/ paths are proxied via HTTP GET/HEAD.
      if (url.pathname.startsWith("/overlay/")) {
        if (req.headers.get("upgrade") === "websocket") {
          const overlayWs = parseOverlayWsPath(url.pathname, config.streamwareUrl);
          if (overlayWs) {
            // Cast to any: Bun.serve is called without a generic data-type
            // parameter so the default is `undefined`. We carry runtime data
            // via the options object and read it back through `ws.data` at
            // handler time — the cast is the approved pattern for this Bun API.
            const upgraded = (server.upgrade as any)(req, {
              data: { kind: "overlay-pump", upstreamUrl: overlayWs.upstreamUrl, token: overlayWs.token },
            });
            if (!upgraded) {
              logger.error("Overlay WebSocket upgrade failed");
              return new Response("WebSocket upgrade failed", { status: 500 });
            }
            return undefined;
          }
          // Unrecognised overlay WS path — fall through to proxyRequest which returns 405.
        }
        logger.info("Overlay proxy", { method: req.method, path: url.pathname, upstream: config.streamwareUrl });
        const proxyResp = await proxyRequest(req, config.streamwareUrl, logger);
        logger.info("Overlay proxy response", { path: url.pathname, status: proxyResp.status });
        return proxyResp;
      }

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
        const data = ws.data as unknown;
        if (data !== null && typeof data === "object" && (data as Record<string, unknown>).kind === "overlay-pump") {
          // Relay client message to the upstream streamware WebSocket.
          const upstream = overlayUpstreams.get(ws);
          if (upstream && upstream.readyState === WebSocket.OPEN) {
            upstream.send(message);
          }
          return;
        }
        // capnweb path
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
        const data = ws.data as unknown;
        if (data !== null && typeof data === "object" && (data as Record<string, unknown>).kind === "overlay-pump") {
          // Overlay pump: open a WebSocket to the upstream streamware WS URL
          // and wire bidirectional relay.
          const pumpData = data as OverlayPumpData;
          logger.debug("Overlay WS pump opening upstream connection", {
            upstreamUrl: pumpData.upstreamUrl,
          });
          const upstream = new WebSocket(pumpData.upstreamUrl);
          overlayUpstreams.set(ws, upstream);

          upstream.addEventListener("open", () => {
            logger.debug("Overlay WS pump: upstream connected");
          });

          upstream.addEventListener("message", (evt) => {
            // Relay upstream message to client; drop on backpressure (code 1013).
            const backpressure = ws.send(
              typeof evt.data === "string" ? evt.data : (evt.data as ArrayBuffer)
            );
            if (backpressure === -1) {
              logger.warn("Overlay WS pump: client send buffer full, closing with 1013");
              ws.close(1013, "Try Again Later");
              upstream.close();
            }
          });

          upstream.addEventListener("close", (evt) => {
            logger.debug("Overlay WS pump: upstream closed", { code: evt.code, reason: evt.reason });
            ws.close(evt.code || 1001, evt.reason || "upstream closed");
          });

          upstream.addEventListener("error", (evt) => {
            logger.error("Overlay WS pump: upstream error", { error: String(evt) });
            ws.close(1011, "upstream error");
          });
          return;
        }
        // capnweb path
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
        const data = ws.data as unknown;
        if (data !== null && typeof data === "object" && (data as Record<string, unknown>).kind === "overlay-pump") {
          logger.debug("Overlay WS pump: client closed", { code, reason });
          const upstream = overlayUpstreams.get(ws);
          if (upstream) {
            upstream.close(code || 1000, reason);
            overlayUpstreams.delete(ws);
          }
          return;
        }
        logger.info("WebSocket connection closed", { code, reason });
        const adapter = wsAdapters.get(ws);
        if (adapter) {
          adapter.dispatchClose(code, reason);
          wsAdapters.delete(ws);
        }
      },
      error(ws, error) {
        const data = ws.data as unknown;
        if (data !== null && typeof data === "object" && (data as Record<string, unknown>).kind === "overlay-pump") {
          logger.error("Overlay WS pump: client error", { error: error.message });
          const upstream = overlayUpstreams.get(ws);
          if (upstream) {
            upstream.close(1011, "client error");
            overlayUpstreams.delete(ws);
          }
          return;
        }
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
  console.log("Failed to start server", err);
  process.exit(1);
});
