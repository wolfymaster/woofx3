import path from "node:path";
import {
  type Attributes,
  type Meter,
  metrics,
  type Span,
  type SpanOptions,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { type Logger as OtelLogger, SeverityNumber } from "@opentelemetry/api-logs";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { type Resource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, type MetricReader, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type Sampler,
  type SpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { FileSpanExporter } from "./file-span-exporter";
import { makeTraceFileName } from "./naming";
import type { LoggingConfig } from "./types";

/**
 * Instrumentation scope for every tracer and logger this package creates.
 * A single scope keeps collector-side filtering trivial; per-service
 * separation comes from the resource's `service.name`.
 */
const INSTRUMENTATION_SCOPE = "@woofx3/common";

export type Telemetry = {
  /** OTel log bridge target, or null when no collector endpoint is configured. */
  readonly otelLogger: OtelLogger | null;
  readonly serviceName: string;
  /** True only when a span processor is actually installed. */
  readonly tracingActive: boolean;
  /** True only when a meter provider is registered; otherwise the global no-op meter stays. */
  readonly metricsActive: boolean;
  shutdown(): Promise<void>;
};

type InitTelemetryOptions = {
  config: LoggingConfig;
  serviceName: string;
};

let telemetry: Telemetry | null = null;

/** `service.name` is applied last: it names the process and must not be overridable by the attribute list. */
export function buildResource(serviceName: string, config: LoggingConfig): Resource {
  const version = config.serviceVersion === "" ? {} : { [ATTR_SERVICE_VERSION]: config.serviceVersion };
  return resourceFromAttributes({ ...config.otelResourceAttributes, ...version, [ATTR_SERVICE_NAME]: serviceName });
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}

export function buildLoggerProvider(serviceName: string, endpoint: string, config: LoggingConfig): LoggerProvider {
  const exporter = new OTLPLogExporter({
    headers: config.otelExporterHeaders,
    url: `${normalizeEndpoint(endpoint)}/v1/logs`,
  });
  return new LoggerProvider({
    processors: [new BatchLogRecordProcessor({ exporter })],
    resource: buildResource(serviceName, config),
  });
}

export function buildMeterProvider(serviceName: string, config: LoggingConfig, reader: MetricReader): MeterProvider {
  return new MeterProvider({ readers: [reader], resource: buildResource(serviceName, config) });
}

function buildOtlpMetricReader(endpoint: string, config: LoggingConfig): PeriodicExportingMetricReader {
  const exporter = new OTLPMetricExporter({
    headers: config.otelExporterHeaders,
    url: `${normalizeEndpoint(endpoint)}/v1/metrics`,
  });
  return new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: config.otelMetricsIntervalMs });
}

/**
 * Parent-based so a sampled caller's trace stays complete across services;
 * the ratio only decides for traces that start here.
 */
export function buildSampler(ratio: number): Sampler {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`trace sampler ratio must be within 0..1, got ${ratio}`);
  }
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
}

/**
 * Picks the span destination. A configured collector always wins; the local
 * file is the fallback that keeps force-enabled tracing from silently
 * dropping every span. Returns null when tracing has nowhere to go, which
 * leaves the global no-op tracer in place.
 */
function buildSpanProcessor(serviceName: string, config: LoggingConfig): SpanProcessor | null {
  if (config.otelExporterEndpoint) {
    const exporter = new OTLPTraceExporter({
      headers: config.otelExporterHeaders,
      url: `${normalizeEndpoint(config.otelExporterEndpoint)}/v1/traces`,
    });
    return new BatchSpanProcessor(exporter);
  }
  if (config.otelLocalFileEnabled) {
    const filePath = path.join(config.logDir, makeTraceFileName(serviceName, new Date()));
    return new BatchSpanProcessor(new FileSpanExporter(filePath));
  }
  return null;
}

/**
 * Idempotent per process: the OTel providers are global singletons, so a
 * second call (a second `createServiceLogger`, or a test re-import) returns
 * the handle the first call built rather than registering a rival provider.
 */
export function initTelemetry(options: InitTelemetryOptions): Telemetry {
  if (telemetry) {
    return telemetry;
  }

  const { config, serviceName } = options;
  if (!serviceName) {
    throw new Error("initTelemetry: serviceName is required");
  }

  if (!config.otelEnabled && !config.otelTracingEnabled && !config.otelMetricsEnabled) {
    telemetry = {
      otelLogger: null,
      serviceName,
      shutdown: async () => {},
      metricsActive: false,
      tracingActive: false,
    };
    return telemetry;
  }

  let loggerProvider: LoggerProvider | null = null;
  let otelLogger: OtelLogger | null = null;
  // Logs have no local-file fallback: the pino file stream already covers
  // that case, so the bridge only exists when a collector can receive it.
  if (config.otelEnabled && config.otelExporterEndpoint) {
    loggerProvider = buildLoggerProvider(serviceName, config.otelExporterEndpoint, config);
    otelLogger = loggerProvider.getLogger(INSTRUMENTATION_SCOPE);
  }

  let tracerProvider: NodeTracerProvider | null = null;
  if (config.otelTracingEnabled) {
    const processor = buildSpanProcessor(serviceName, config);
    if (processor) {
      tracerProvider = new NodeTracerProvider({
        resource: buildResource(serviceName, config),
        sampler: buildSampler(config.otelTracesSamplerRatio),
        spanProcessors: [processor],
      });
      // Only W3C trace context crosses process boundaries; baggage is deliberately left out.
      tracerProvider.register({ propagator: new W3CTraceContextPropagator() });
    }
  }

  // Like logs, metrics have no local-file fallback: without a collector the global no-op meter stays.
  let meterProvider: MeterProvider | null = null;
  if (config.otelMetricsEnabled && config.otelExporterEndpoint) {
    meterProvider = buildMeterProvider(serviceName, config, buildOtlpMetricReader(config.otelExporterEndpoint, config));
    metrics.setGlobalMeterProvider(meterProvider);
  }

  telemetry = {
    metricsActive: meterProvider != null,
    otelLogger,
    serviceName,
    shutdown: async () => {
      await Promise.all([loggerProvider?.shutdown(), tracerProvider?.shutdown(), meterProvider?.shutdown()]);
    },
    tracingActive: tracerProvider != null,
  };
  return telemetry;
}

export function getTelemetry(): Telemetry | null {
  return telemetry;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetry) {
    return;
  }
  await telemetry.shutdown();
}

export function getMeter(name: string = INSTRUMENTATION_SCOPE): Meter {
  return metrics.getMeter(name);
}

export function getTracer(name: string = INSTRUMENTATION_SCOPE): Tracer {
  return trace.getTracer(name);
}

/**
 * Trace/span ids of the currently active span, or null when nothing is
 * recording. Used to stamp log lines so file/console output correlates with
 * exported spans without every call site passing the ids by hand.
 */
export function currentTraceContext(): { spanId: string; traceFlags: string; traceId: string } | null {
  const span = trace.getActiveSpan();
  if (!span) {
    return null;
  }
  const spanContext = span.spanContext();
  if (!spanContext.traceId) {
    return null;
  }
  return {
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags.toString(16).padStart(2, "0"),
    traceId: spanContext.traceId,
  };
}

export type WithSpanOptions = {
  attributes?: Attributes;
  kind?: SpanOptions["kind"];
  tracerName?: string;
};

/**
 * Runs `fn` inside an active span, recording thrown errors before rethrowing.
 * When tracing is disabled the global no-op tracer makes this a thin
 * pass-through, so call sites are safe to add unconditionally.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options: WithSpanOptions = {}
): Promise<T> {
  if (!name) {
    throw new Error("withSpan: name is required");
  }
  const tracer = getTracer(options.tracerName);
  return tracer.startActiveSpan(
    name,
    { attributes: options.attributes, kind: options.kind },
    async (span: Span): Promise<T> => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

const severityByPinoLevel: Record<string, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
  info: SeverityNumber.INFO,
  trace: SeverityNumber.TRACE,
  warn: SeverityNumber.WARN,
};

export function pinoLevelToSeverity(level: string): SeverityNumber {
  return severityByPinoLevel[level] ?? SeverityNumber.UNSPECIFIED;
}
