package logging

import (
	"context"
	"fmt"
	"io"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

const defaultMetricsInterval = 60 * time.Second

// Meter returns a meter on the globally registered provider. Without a
// collector the global provider is the OTel no-op implementation, so call sites
// need no feature flag of their own.
func Meter() metric.Meter {
	return otel.Meter(tracerName)
}

// startMetrics installs a MeterProvider when metrics are enabled and a
// collector is configured, and returns a closer that flushes it. Like logs,
// metrics have no local-file fallback: without a collector it returns a nil
// closer and the global no-op provider stays.
func startMetrics(resolved resolvedConfig) (io.Closer, error) {
	if !resolved.OTelMetricsEnabled || resolved.OTelExporterEndpoint == "" {
		return nil, nil
	}

	endpointURL, err := otelEndpointURL(resolved.OTelExporterEndpoint, otlpMetricsPath)
	if err != nil {
		return nil, err
	}
	options := []otlpmetrichttp.Option{otlpmetrichttp.WithEndpointURL(endpointURL)}
	if len(resolved.OTelExporterHeaders) > 0 {
		options = append(options, otlpmetrichttp.WithHeaders(resolved.OTelExporterHeaders))
	}
	// stylegate:ignore GO-API-001 reason="built once at startup from New, which takes no ctx; the exporter does not dial until the first export"
	exporter, err := otlpmetrichttp.New(context.Background(), options...)
	if err != nil {
		return nil, fmt.Errorf("create OTLP metric exporter: %w", err)
	}

	provider := newMeterProvider(resolved, sdkmetric.NewPeriodicReader(exporter, sdkmetric.WithInterval(resolved.OTelMetricsInterval)))
	otel.SetMeterProvider(provider)
	return &meterProviderCloser{provider: provider}, nil
}

// newMeterProvider is split from startMetrics so a test can read measurements
// back through an in-memory reader.
func newMeterProvider(resolved resolvedConfig, reader sdkmetric.Reader) *sdkmetric.MeterProvider {
	return sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(reader),
		sdkmetric.WithResource(newOTelResource(resolved)),
	)
}

type meterProviderCloser struct {
	provider *sdkmetric.MeterProvider
}

func (c *meterProviderCloser) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), otelShutdownTimeout)
	defer cancel()

	if err := c.provider.Shutdown(ctx); err != nil {
		return fmt.Errorf("shutdown meter provider: %w", err)
	}
	return nil
}
