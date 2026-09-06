import fs from "node:fs";
import path from "node:path";
import type { HrTime } from "@opentelemetry/api";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

function hrTimeToIso(time: HrTime): string {
  const millis = time[0] * 1_000 + time[1] / 1_000_000;
  return new Date(millis).toISOString();
}

function hrTimeToMillis(time: HrTime): number {
  return time[0] * 1_000 + time[1] / 1_000_000;
}

function serializeSpan(span: ReadableSpan): Record<string, unknown> {
  const spanContext = span.spanContext();
  return {
    attributes: span.attributes,
    durationMs: hrTimeToMillis(span.duration),
    endTime: hrTimeToIso(span.endTime),
    events: span.events.map((event) => {
      return {
        attributes: event.attributes ?? {},
        name: event.name,
        time: hrTimeToIso(event.time),
      };
    }),
    kind: span.kind,
    name: span.name,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    scope: span.instrumentationScope.name,
    service: span.resource.attributes["service.name"] ?? null,
    spanId: spanContext.spanId,
    startTime: hrTimeToIso(span.startTime),
    status: { code: span.status.code, message: span.status.message ?? null },
    traceFlags: spanContext.traceFlags,
    traceId: spanContext.traceId,
  };
}

/**
 * Newline-delimited-JSON span exporter used when tracing is enabled but no
 * OTLP collector is configured. Mirrors the pino file stream: one append-only
 * file per process boot under the same `logDir`.
 */
export class FileSpanExporter implements SpanExporter {
  private readonly stream: fs.WriteStream;
  private shuttingDown = false;

  constructor(filePath: string) {
    if (!filePath) {
      throw new Error("FileSpanExporter: filePath is required");
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.shuttingDown) {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error("FileSpanExporter is shut down") });
      return;
    }
    try {
      for (const span of spans) {
        this.stream.write(`${JSON.stringify(serializeSpan(span))}\n`);
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  async forceFlush(): Promise<void> {
    return;
  }

  shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return Promise.resolve();
    }
    this.shuttingDown = true;
    return new Promise<void>((resolve) => {
      this.stream.end(() => {
        resolve();
      });
    });
  }
}
