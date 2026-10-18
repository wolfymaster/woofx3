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
