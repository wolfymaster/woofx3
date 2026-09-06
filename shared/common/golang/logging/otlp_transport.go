package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
)

// OTLPTransport ships log records to an OpenTelemetry collector over OTLP
// HTTP. It is inert unless both OTel is enabled and an exporter endpoint is
// configured, so the default console plus file behavior is unchanged when no
// collector exists.
type OTLPTransport struct{}

func NewOTLPTransport() *OTLPTransport {
	return &OTLPTransport{}
}

func (t *OTLPTransport) Name() string {
	return "otlp"
}

func (t *OTLPTransport) Build(resolved resolvedConfig, level *slog.LevelVar) (slog.Handler, io.Closer, error) {
	if !resolved.OTelEnabled || resolved.OTelExporterEndpoint == "" {
		return nil, nil, nil
	}

	endpointURL, err := otelEndpointURL(resolved.OTelExporterEndpoint, otlpLogsPath)
	if err != nil {
		return nil, nil, err
	}

	exporter, err := otlploghttp.New(context.Background(), otlploghttp.WithEndpointURL(endpointURL))
	if err != nil {
		return nil, nil, fmt.Errorf("create OTLP log exporter: %w", err)
	}

	provider := sdklog.NewLoggerProvider(
		sdklog.WithResource(newOTelResource(resolved.ServiceName)),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
	)

	// The bridge decides severity from the OTel logger, not from our level
	// var, so gate it explicitly to keep every transport on the same level.
	handler := &levelGateHandler{
		inner: otelslog.NewHandler(resolved.ServiceName, otelslog.WithLoggerProvider(provider)),
		level: level,
	}

	return handler, &loggerProviderCloser{provider: provider}, nil
}

type levelGateHandler struct {
	inner slog.Handler
	level *slog.LevelVar
}

func (h *levelGateHandler) Enabled(ctx context.Context, level slog.Level) bool {
	if level < h.level.Level() {
		return false
	}
	return h.inner.Enabled(ctx, level)
}

func (h *levelGateHandler) Handle(ctx context.Context, record slog.Record) error {
	return h.inner.Handle(ctx, record)
}

func (h *levelGateHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &levelGateHandler{inner: h.inner.WithAttrs(attrs), level: h.level}
}

func (h *levelGateHandler) WithGroup(name string) slog.Handler {
	return &levelGateHandler{inner: h.inner.WithGroup(name), level: h.level}
}

type loggerProviderCloser struct {
	provider *sdklog.LoggerProvider
}

func (c *loggerProviderCloser) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), otelShutdownTimeout)
	defer cancel()
	if err := c.provider.Shutdown(ctx); err != nil {
		return fmt.Errorf("shutdown OTLP logger provider: %w", err)
	}
	return nil
}
