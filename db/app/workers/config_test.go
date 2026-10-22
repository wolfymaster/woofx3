package workers

import (
	"strings"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr []string
		check   func(t *testing.T, c Config)
	}{
		{
			name: "defaults when nothing is set",
			env:  map[string]string{},
			check: func(t *testing.T, c Config) {
				if c.EventDetailRetention != 7*24*time.Hour || c.EventDetailPruneBatch != 1000 {
					t.Fatalf("defaults = %+v", c)
				}
			},
		},
		{
			name: "a set retention is used",
			env:  map[string]string{"EVENT_DETAIL_RETENTION_PERIOD": "72h"},
			check: func(t *testing.T, c Config) {
				if c.EventDetailRetention != 72*time.Hour {
					t.Fatalf("EventDetailRetention = %s, want 72h", c.EventDetailRetention)
				}
			},
		},
		{
			name:    "a retention that is not a duration",
			env:     map[string]string{"EVENT_DETAIL_RETENTION_PERIOD": "7 days"},
			wantErr: []string{`EVENT_DETAIL_RETENTION_PERIOD="7 days" is not a duration`},
		},
		{
			name:    "a zero retention",
			env:     map[string]string{"EVENT_DETAIL_RETENTION_PERIOD": "0s"},
			wantErr: []string{`EVENT_DETAIL_RETENTION_PERIOD="0s" must be positive`},
		},
		{
			name:    "a negative retention",
			env:     map[string]string{"EVENT_DETAIL_RETENTION_PERIOD": "-1h"},
			wantErr: []string{"must be positive"},
		},
		{
			name: "every bad value at once",
			env: map[string]string{
				"EVENT_DETAIL_RETENTION_PERIOD": "soon",
				"OUTBOX_BATCH_SIZE":             "many",
				"FACT_DEDUPE_PRUNE_BATCH_SIZE":  "0",
			},
			wantErr: []string{
				"EVENT_DETAIL_RETENTION_PERIOD",
				`OUTBOX_BATCH_SIZE="many" is not a whole number`,
				`FACT_DEDUPE_PRUNE_BATCH_SIZE="0" must be positive`,
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, err := loadConfig(func(key string) string { return tc.env[key] })
			if len(tc.wantErr) > 0 {
				if err == nil {
					t.Fatalf("loadConfig accepted %v", tc.env)
				}
				for _, want := range tc.wantErr {
					if !strings.Contains(err.Error(), want) {
						t.Fatalf("error %q does not mention %q", err, want)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("loadConfig: %v", err)
			}
			tc.check(t, c)
		})
	}
}
