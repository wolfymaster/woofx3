package logging

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// StartSpan begins a span on the globally registered tracer provider. When
// tracing is disabled the global provider is the OTel no-op implementation, so
// call sites stay allocation-cheap and need no feature flag of their own.
func StartSpan(ctx context.Context, name string, attributes ...attribute.KeyValue) (context.Context, trace.Span) {
	return otel.Tracer(tracerName).Start(ctx, name, trace.WithAttributes(attributes...))
}

// startTracing installs a TracerProvider when tracing is enabled and returns a
// closer that flushes it. It returns a nil closer when tracing is off, leaving
// the global no-op provider in place.
func startTracing(resolved resolvedConfig) (io.Closer, error) {
	if !resolved.OTelTracingEnabled {
		return nil, nil
	}

	exporter, spanFile, err := buildSpanExporter(resolved)
	if err != nil {
		return nil, err
	}
	if exporter == nil {
		// Tracing was requested but there is nowhere to put spans: no
		// collector and local files disabled. Leave the no-op provider.
		return nil, nil
	}

	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(newOTelResource(resolved.ServiceName)),
	)

	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return &tracerProviderCloser{provider: provider, spanFile: spanFile}, nil
}

// buildSpanExporter prefers the collector. Without one it falls back to a
// local span file so force-enabled tracing still produces something to read.
func buildSpanExporter(resolved resolvedConfig) (sdktrace.SpanExporter, io.Closer, error) {
	if resolved.OTelExporterEndpoint != "" {
		endpointURL, err := otelEndpointURL(resolved.OTelExporterEndpoint, otlpTracesPath)
		if err != nil {
			return nil, nil, err
		}
		exporter, err := otlptracehttp.New(context.Background(), otlptracehttp.WithEndpointURL(endpointURL))
		if err != nil {
			return nil, nil, fmt.Errorf("create OTLP trace exporter: %w", err)
		}
		return exporter, nil, nil
	}

	if !resolved.OTelLocalFileEnabled {
		return nil, nil, nil
	}

	if err := os.MkdirAll(resolved.LogDirectory, 0o755); err != nil {
		return nil, nil, fmt.Errorf("create trace directory: %w", err)
	}

	filePath := filepath.Join(resolved.LogDirectory, makeTraceFileName(resolved.ServiceName, time.Now()))
	spanFile, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, nil, fmt.Errorf("open trace file: %w", err)
	}

	exporter, err := stdouttrace.New(stdouttrace.WithWriter(spanFile))
	if err != nil {
		spanFile.Close()
		return nil, nil, fmt.Errorf("create local trace exporter: %w", err)
	}
	return exporter, spanFile, nil
}

func makeTraceFileName(serviceName string, now time.Time) string {
	return fmt.Sprintf("%s_traces_%s.log", serviceName, now.Format("20060102_1504"))
}

type tracerProviderCloser struct {
	provider *sdktrace.TracerProvider
	spanFile io.Closer
}

func (c *tracerProviderCloser) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), otelShutdownTimeout)
	defer cancel()

	shutdownErr := c.provider.Shutdown(ctx)
	if c.spanFile != nil {
		if err := c.spanFile.Close(); err != nil && shutdownErr == nil {
			shutdownErr = err
		}
	}
	if shutdownErr != nil {
		return fmt.Errorf("shutdown tracer provider: %w", shutdownErr)
	}
	return nil
}
