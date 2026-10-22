package main

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
)

func TestOrderedTurnTimeoutFromEnv(t *testing.T) {
	base := map[string]string{
		"WOOFX3_BARKLOADER_WS_URL":  "ws://barkloader",
		"WOOFX3_DATABASE_PROXY_URL": "http://db",
		"WOOFX3_SCENE_MANAGER_URL":  "http://scenes",
		"WOOFX3_MESSAGEBUS_URL":     "nats://bus",
	}
	tests := []struct {
		name    string
		value   string
		want    time.Duration
		wantErr bool
	}{
		{name: "unset leaves the engine default", value: "", want: 0},
		{name: "seconds become a duration", value: "45", want: 45 * time.Second},
		{name: "negative is refused", value: "-1", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{"WOOFX3_WORKFLOW_ORDERED_TURN_TIMEOUT_SECONDS": tc.value}
			for k, v := range base {
				env[k] = v
			}
			cfg := &WorkflowEnvConfig{}
			if err := runtime.FillEnvConfig(env, cfg); err != nil {
				t.Fatalf("FillEnvConfig: %v", err)
			}
			got, err := cfg.orderedTurnTimeout()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("got %s, want an error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("orderedTurnTimeout: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestDbRequestTimeoutFromEnv(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    time.Duration
		wantErr bool
	}{
		{name: "unset uses the default", value: "", want: DefaultDbRequestTimeout},
		{name: "a duration is taken as is", value: "750ms", want: 750 * time.Millisecond},
		{name: "a bare number is refused", value: "5", wantErr: true},
		{name: "zero is refused", value: "0s", wantErr: true},
		{name: "negative is refused", value: "-1s", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &WorkflowEnvConfig{}
			env := map[string]string{
				"WOOFX3_BARKLOADER_WS_URL":   "ws://barkloader",
				"WOOFX3_DATABASE_PROXY_URL":  "http://db",
				"WOOFX3_SCENE_MANAGER_URL":   "http://scenes",
				"WOOFX3_MESSAGEBUS_URL":      "nats://bus",
				"WOOFX3_WORKFLOW_DB_TIMEOUT": tc.value,
			}
			if err := runtime.FillEnvConfig(env, cfg); err != nil {
				t.Fatalf("FillEnvConfig: %v", err)
			}
			got, err := cfg.dbRequestTimeout()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("got %s, want an error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("dbRequestTimeout: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestRunRetentionFromEnv(t *testing.T) {
	defaults := engine.DefaultRetentionConfig()
	tests := []struct {
		name    string
		env     map[string]string
		want    engine.RetentionConfig
		wantErr bool
	}{
		{name: "unset uses the defaults", env: map[string]string{}, want: defaults},
		{
			name: "each value is taken as is",
			env: map[string]string{
				"WOOFX3_WORKFLOW_RUN_RETENTION":      "5m",
				"WOOFX3_WORKFLOW_RUN_SWEEP_INTERVAL": "10s",
				"WOOFX3_WORKFLOW_MAX_SETTLED_RUNS":   "500",
			},
			want: engine.RetentionConfig{RetentionTTL: 5 * time.Minute, SweepInterval: 10 * time.Second, MaxSettledRuns: 500},
		},
		{name: "a bare number retention is refused", env: map[string]string{"WOOFX3_WORKFLOW_RUN_RETENTION": "120"}, wantErr: true},
		{name: "zero retention is refused", env: map[string]string{"WOOFX3_WORKFLOW_RUN_RETENTION": "0s"}, wantErr: true},
		{name: "negative sweep interval is refused", env: map[string]string{"WOOFX3_WORKFLOW_RUN_SWEEP_INTERVAL": "-1s"}, wantErr: true},
		{name: "negative cap is refused", env: map[string]string{"WOOFX3_WORKFLOW_MAX_SETTLED_RUNS": "-1"}, wantErr: true},
		{name: "zero cap is refused", env: map[string]string{"WOOFX3_WORKFLOW_MAX_SETTLED_RUNS": "0"}, wantErr: true},
		{name: "a cap that is not a number is refused", env: map[string]string{"WOOFX3_WORKFLOW_MAX_SETTLED_RUNS": "lots"}, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{
				"WOOFX3_BARKLOADER_WS_URL":  "ws://barkloader",
				"WOOFX3_DATABASE_PROXY_URL": "http://db",
				"WOOFX3_SCENE_MANAGER_URL":  "http://scenes",
				"WOOFX3_MESSAGEBUS_URL":     "nats://bus",
			}
			for k, v := range tc.env {
				env[k] = v
			}
			cfg := &WorkflowEnvConfig{}
			if err := runtime.FillEnvConfig(env, cfg); err != nil {
				t.Fatalf("FillEnvConfig: %v", err)
			}
			got, err := cfg.runRetention()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("got %+v, want an error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("runRetention: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}
