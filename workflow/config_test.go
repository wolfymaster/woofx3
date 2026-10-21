package main

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/runtime"
)

func TestOrderedTurnTimeoutFromEnv(t *testing.T) {
	base := map[string]string{
		"WOOFX3_BARKLOADER_WS_URL":  "ws://barkloader",
		"WOOFX3_DATABASE_PROXY_URL": "http://db",
		"WOOFX3_SCENE_MANAGER_URL":  "http://scenes",
		"WOOFX3_MESSAGEBUS_URL":     "nats://bus",
		"WOOFX3_DB_PROXY_TOKEN":     "0123456789abcdef0123456789abcdef",
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

func TestDbProxyToken(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "a long random token is used", value: "0123456789abcdef0123456789abcdef"},
		{name: "a placeholder is refused", value: "CHANGE_ME", wantErr: true},
		{name: "a short token is refused", value: "short", wantErr: true},
		{name: "blank is refused", value: "  ", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &WorkflowEnvConfig{DbProxyToken: tc.value}
			got, err := cfg.dbProxyToken()
			if tc.wantErr {
				if err == nil {
					t.Fatal("dbProxyToken succeeded, want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("dbProxyToken: %v", err)
			}
			if got != tc.value {
				t.Fatalf("dbProxyToken = %q, want %q", got, tc.value)
			}
		})
	}
}
