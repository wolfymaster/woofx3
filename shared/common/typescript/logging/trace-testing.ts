import { context, propagation, type Span, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const exporter = new InMemorySpanExporter();
let installed = false;

/**
 * Installs a global tracer provider with an in-memory exporter and the W3C
 * propagator, so a test can drive inject/extract through the real global API
 * and read back the spans it produced. OTel globals can be registered once
 * per process, hence the shared singleton; call `reset()` between tests.
 */
export class TraceHarness {
  static install(): TraceHarness {
    if (!installed) {
      new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register({
        propagator: new W3CTraceContextPropagator(),
      });
      installed = true;
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

  /** The W3C headers describing the active context, as an outgoing request would carry them. */
  headers(): Record<string, string> {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
  }
}
