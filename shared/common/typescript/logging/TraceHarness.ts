import { context, propagation, ROOT_CONTEXT, type Span, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const exporter = new InMemorySpanExporter();

/**
 * Installs a global tracer provider with an in-memory exporter and the W3C
 * propagator, so a test can drive inject/extract through the real global API
 * and read back the spans it produced. OTel globals can be registered once
 * per process, hence the shared singleton; call `reset()` between tests.
 */
export class TraceHarness {
  // Static because the OTel global provider can be registered once per process.
  private static installed = false;

  static install(): TraceHarness {
    if (!TraceHarness.installed) {
      new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register({
        propagator: new W3CTraceContextPropagator(),
      });
      TraceHarness.installed = true;
    }
    return new TraceHarness();
  }

  reset(): void {
    exporter.reset();
  }

  /** Finished spans, oldest first. */
  spans(): ReadableSpan[] {
    return exporter.getFinishedSpans();
  }

  /** Starts a span, runs `fn` with it active, ends it. */
  async inSpan<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T> {
    return trace.getTracer("test").startActiveSpan(name, async (span) => {
      try {
        return await fn(span);
      } finally {
        span.end();
      }
    });
  }

  /** The trace id a W3C `traceparent` value names, or undefined when it is not a valid one. */
  traceIdOf(traceparent: string | undefined): string | undefined {
    const carrier = traceparent === undefined ? {} : { traceparent };
    return trace.getSpanContext(propagation.extract(ROOT_CONTEXT, carrier))?.traceId;
  }

  /** The W3C headers describing the active context, as an outgoing request would carry them. */
  headers(): Record<string, string> {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
  }
}
