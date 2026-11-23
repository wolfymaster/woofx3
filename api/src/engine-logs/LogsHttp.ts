import type { LogAccessScope, LogLevel } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type { LogAccessTokens } from "./LogAccessTokens";
import { zipLogFiles } from "./log-export";
import type { LogStore } from "./LogStore";

export interface LogsHttpConfig {
  /** How often a live tail looks for new lines. */
  pollMs: number;
  /** How often an idle stream sends a comment so a proxy does not close it. */
  heartbeatMs: number;
}

export const DEFAULT_LOGS_HTTP_CONFIG: LogsHttpConfig = { pollMs: 500, heartbeatMs: 15_000 };

export interface LogsHttpDeps {
  store: LogStore;
  tokens: LogAccessTokens;
  logger: SharedLogger;
  config: LogsHttpConfig;
  now: () => Date;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** What the transport lends a handler: the CORS headers for this request, and a way to lift the idle cutoff. */
export interface LogsRequestContext {
  cors: Record<string, string>;
  disableIdleTimeout: () => void;
}

export const LOGS_PATH_PREFIX = "/logs/";

/** Each route's name after the prefix, and the token scope it demands. */
const ROUTE_SCOPES: Readonly<Record<string, LogAccessScope | undefined>> = { stream: "stream", export: "export" };

const encoder = new TextEncoder();

function errorResponse(status: number, code: string, message: string, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function list(value: string | null): string[] {
  return value === null || value === "" ? [] : value.split(",");
}

/**
 * `GET /logs/stream` (server-sent events) and `GET /logs/export` (a zip). Kept
 * off the capnweb surface because a browser's `EventSource` and download link
 * cannot speak it; the token an authenticated RPC call minted stands in for
 * the credential they cannot send.
 */
export class LogsHttp {
  constructor(private readonly deps: LogsHttpDeps) {}

  async handle(req: Request, url: URL, context: LogsRequestContext): Promise<Response> {
    const route = url.pathname.slice(LOGS_PATH_PREFIX.length);
    const scope = ROUTE_SCOPES[route];
    if (scope === undefined) {
      return errorResponse(404, "not_found", "no such log route", context.cors);
    }
    if (req.method !== "GET") {
      return errorResponse(405, "method_not_allowed", "use GET", context.cors);
    }
    const token = url.searchParams.get("token");
    if (token === null || !this.deps.tokens.verify(token, scope)) {
      this.deps.logger.warn("Refused a log request with a missing or invalid token", { scope });
      return errorResponse(
        401,
        "unauthorized",
        "the log access token is missing, expired or not for this route",
        context.cors
      );
    }
    try {
      return scope === "stream" ? await this.stream(req, url, context) : await this.export(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn("Log request failed", { scope, error: message });
      return errorResponse(400, "bad_request", message, context.cors);
    }
  }

  private async export(context: LogsRequestContext): Promise<Response> {
    const files = await this.deps.store.listAllFiles();
    const stamp = this.deps.now().toISOString().replace(/[:.]/g, "-");
    this.deps.logger.info("Streaming a log export", { files: files.length });
    return new Response(zipLogFiles(files), {
      headers: {
        ...context.cors,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="woofx3-logs-${stamp}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  }

  private async stream(req: Request, url: URL, context: LogsRequestContext): Promise<Response> {
    const { store, config } = this.deps;
    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const resume = req.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
    const records = await store.tail(
      {
        levels: list(url.searchParams.get("levels")) as LogLevel[],
        services: list(url.searchParams.get("services")),
        text: url.searchParams.get("text") ?? "",
      },
      { after: resume === "" ? null : resume, signal: abort.signal, pollMs: config.pollMs, sleep: this.deps.sleep }
    );

    context.disableIdleTimeout();
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(": connected\n\n"));
        const keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), config.heartbeatMs);
        void (async () => {
          try {
            for await (const { record, resumeId } of records) {
              controller.enqueue(encoder.encode(`id: ${resumeId}\nevent: log\ndata: ${JSON.stringify(record)}\n\n`));
            }
          } catch (error) {
            this.deps.logger.warn("A log stream ended with an error", {
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            clearInterval(keepalive);
            try {
              controller.close();
            } catch {
              // The reader already cancelled, which closed the controller.
            }
          }
        })();
      },
      cancel: () => abort.abort(),
    });
    return new Response(body, {
      headers: {
        ...context.cors,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
