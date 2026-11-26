package logging

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestResolveConfigMetrics(t *testing.T) {
	off := false
	tests := []struct {
		name         string
		env          map[string]string
		cfg          Config
		wantEnabled  bool
		wantInterval time.Duration
	}{
		{name: "off with nothing configured", wantInterval: defaultMetricsInterval},
		{
			name:         "an endpoint turns metrics on",
			env:          map[string]string{envOTelExporterEndpoint: "http://localhost:4318"},
			wantEnabled:  true,
			wantInterval: defaultMetricsInterval,
		},
		{
			name:         "the master switch turns them off",
			env:          map[string]string{envOTelExporterEndpoint: "http://localhost:4318", envOTelEnabled: "false"},
			wantInterval: defaultMetricsInterval,
		},
		{
			name:         "the override turns only metrics off",
			env:          map[string]string{envOTelExporterEndpoint: "http://localhost:4318", envOTelMetricsEnabled: "false"},
			wantInterval: defaultMetricsInterval,
		},
		{
			name:         "an explicit field beats the environment",
			env:          map[string]string{envOTelExporterEndpoint: "http://localhost:4318"},
			cfg:          Config{OTelMetricsEnabled: &off},
			wantInterval: defaultMetricsInterval,
		},
		{
			name:         "the interval comes from the environment",
			env:          map[string]string{envOTelMetricsInterval: "5000"},
			wantInterval: 5 * time.Second,
		},
		{
			name:         "an explicit interval beats the environment",
			env:          map[string]string{envOTelMetricsInterval: "5000"},
			cfg:          Config{OTelMetricsInterval: time.Second},
			wantInterval: time.Second,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for key, value := range tc.env {
				t.Setenv(key, value)
			}
			tc.cfg.ServiceName = "test"
			resolved, err := resolveConfig(tc.cfg)
			if err != nil {
				t.Fatalf("resolveConfig: %v", err)
			}
			if resolved.OTelMetricsEnabled != tc.wantEnabled {
				t.Fatalf("metrics enabled = %v, want %v", resolved.OTelMetricsEnabled, tc.wantEnabled)
			}
			if resolved.OTelMetricsInterval != tc.wantInterval {
				t.Fatalf("interval = %s, want %s", resolved.OTelMetricsInterval, tc.wantInterval)
			}
		})
	}
}

func TestResolveConfigRejectsUnusableMetricsInterval(t *testing.T) {
	for _, raw := range []string{"0", "-1", "1.5", "soon"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv(envOTelMetricsInterval, raw)
			if _, err := resolveConfig(Config{ServiceName: "test"}); err == nil {
				t.Fatalf("an interval of %q must be refused", raw)
			}
		})
	}
	if _, err := resolveConfig(Config{ServiceName: "test", OTelMetricsInterval: -time.Second}); err == nil {
		t.Fatal("a negative explicit interval must be refused")
	}
}

func TestStartMetricsLeavesTheNoOpMeterWithoutACollector(t *testing.T) {
	resolved, err := resolveConfig(Config{ServiceName: "test", OTelEnabled: boolPtr(true)})
	if err != nil {
		t.Fatalf("resolveConfig: %v", err)
	}
	closer, err := startMetrics(resolved)
	if err != nil {
		t.Fatalf("startMetrics: %v", err)
	}
	if closer != nil {
		t.Fatal("no endpoint must install no provider")
	}
}

func TestMeterProviderExportsWithTheEnginesResource(t *testing.T) {
	t.Setenv(envOTelResourceAttrs, "service.namespace=alpha")
	resolved, err := resolveConfig(Config{ServiceName: "api"})
	if err != nil {
		t.Fatalf("resolveConfig: %v", err)
	}
	reader := sdkmetric.NewManualReader()
	provider := newMeterProvider(resolved, reader)
	defer provider.Shutdown(context.Background())

	counter, err := provider.Meter("test").Int64Counter("woofx3.test", metric.WithUnit("1"))
	if err != nil {
		t.Fatalf("counter: %v", err)
	}
	counter.Add(context.Background(), 2, metric.WithAttributes(attribute.String("kind", "a")))

	var collected metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &collected); err != nil {
		t.Fatalf("collect: %v", err)
	}
	if got, _ := collected.Resource.Set().Value("service.namespace"); got.AsString() != "alpha" {
		t.Fatalf("service.namespace = %q, want alpha", got.AsString())
	}
	if got, _ := collected.Resource.Set().Value("service.name"); got.AsString() != "api" {
		t.Fatalf("service.name = %q, want api", got.AsString())
	}
	sum, ok := collected.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64])
	if !ok || len(sum.DataPoints) != 1 || sum.DataPoints[0].Value != 2 {
		t.Fatalf("unexpected data: %#v", collected.ScopeMetrics[0].Metrics[0].Data)
	}
}

func boolPtr(value bool) *bool {
	return &value
}
