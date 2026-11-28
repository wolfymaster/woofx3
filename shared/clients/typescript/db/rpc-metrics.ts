import {
  getTracer,
  type Meter,
  SHORT_DURATION_BUCKETS_SECONDS,
  SpanKind,
  SpanStatusCode,
  withTraceHeaders,
} from "@woofx3/common/logging";
import type { RpcTransport } from "twirpscript";

type RpcTransportResponse = Awaited<ReturnType<RpcTransport>>;

const MS_PER_SECOND = 1000;
const TWIRP_PATH = /\/twirp\/([^/]+)\/([^/?]+)$/;

/** The `error.type` for a call that never produced a Twirp error: the HTTP status, or "request" for no response at all. */
const REQUEST_FAILED = "request";

interface TwirpErrorBody {
  code?: unknown;
}

/**
 * Wraps `transport` so every call reports `rpc.client.duration`, whether it
 * succeeds, comes back as a Twirp error, or never gets a response.
 * `rpc.service` and `rpc.method` come from the request path, a fixed set per
 * client; `error.type` is the Twirp error code.
 */
export function instrumentTransport(
  meter: Meter,
  transport: RpcTransport,
  now: () => number = () => performance.now()
): RpcTransport {
  const duration = meter.createHistogram("rpc.client.duration", {
    advice: { explicitBucketBoundaries: [...SHORT_DURATION_BUCKETS_SECONDS] },
    description: "Time a Twirp call took, from send to response headers.",
    unit: "s",
  });
  return async (url, opts) => {
    const match = TWIRP_PATH.exec(new URL(url).pathname);
    const attributes: Record<string, string> = {
      "rpc.system": "twirp",
      "rpc.service": match?.[1] ?? "unknown",
      "rpc.method": match?.[2] ?? "unknown",
    };
    // The span is active while the headers are built, so db-proxy's server span becomes its child.
    return getTracer().startActiveSpan(
      `${attributes["rpc.service"]}/${attributes["rpc.method"]}`,
      { attributes, kind: SpanKind.CLIENT },
      async (span) => {
        const startedAt = now();
        try {
          const response = await transport(url, { ...opts, headers: withTraceHeaders(opts.headers) });
          const settled = response.ok ? response : await bufferedError(response);
          if (!settled.ok) {
            attributes["error.type"] = await twirpCode(settled);
            span.setStatus({ code: SpanStatusCode.ERROR, message: attributes["error.type"] });
          }
          duration.record((now() - startedAt) / MS_PER_SECOND, attributes);
          return settled;
        } catch (err) {
          attributes["error.type"] = REQUEST_FAILED;
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.setStatus({ code: SpanStatusCode.ERROR, message: REQUEST_FAILED });
          duration.record((now() - startedAt) / MS_PER_SECOND, attributes);
          throw err;
        } finally {
          span.end();
        }
      }
    );
  };
}

/** An error response whose body can be read here and again by twirpscript. */
async function bufferedError(response: RpcTransportResponse): Promise<RpcTransportResponse> {
  const text = await response.text();
  return {
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
    headers: response.headers,
    json: async () => JSON.parse(text),
    ok: response.ok,
    status: response.status,
    text: async () => text,
  };
}

async function twirpCode(response: RpcTransportResponse): Promise<string> {
  let body: TwirpErrorBody;
  try {
    body = (await response.json()) as TwirpErrorBody;
  } catch {
    // A proxy's HTML error page is not a Twirp body; its status is all there is.
    return `http_${response.status}`;
  }
  return typeof body?.code === "string" ? body.code : `http_${response.status}`;
}
