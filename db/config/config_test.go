package config

import (
	"reflect"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/runtime"
)

// requiredEnv is the minimum DatabaseEnvConfig accepts.
func requiredEnv() map[string]string {
	return map[string]string{
		"WOOFX3_DATABASE_URL":   "sqlite://./data/test.db",
		"WOOFX3_STORAGE_PATH":   "./data/module-storage.db",
		"WOOFX3_SECRETS_KEY":    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		"WOOFX3_MESSAGEBUS_URL": "ws://127.0.0.1:4225",
		"WOOFX3_DB_PROXY_TOKEN": "0123456789abcdef0123456789abcdef",
	}
}

func TestTheServiceTokenIsRequired(t *testing.T) {
	env := requiredEnv()
	delete(env, "WOOFX3_DB_PROXY_TOKEN")
	cfg := &DatabaseEnvConfig{}
	if err := runtime.FillEnvConfig(env, cfg); err == nil {
		t.Fatal("FillEnvConfig succeeded without WOOFX3_DB_PROXY_TOKEN, want an error")
	}
}

func TestDatabaseProxyBindsLoopbackByDefault(t *testing.T) {
	cfg := &DatabaseEnvConfig{}
	if err := runtime.FillEnvConfig(requiredEnv(), cfg); err != nil {
		t.Fatalf("FillEnvConfig: %v", err)
	}

	if cfg.DatabaseProxyHost != "127.0.0.1" {
		t.Fatalf("DatabaseProxyHost = %q, want 127.0.0.1", cfg.DatabaseProxyHost)
	}
}

func TestDatabaseProxyBindsTheConfiguredHost(t *testing.T) {
	env := requiredEnv()
	env["WOOFX3_DATABASE_PROXY_HOST"] = "0.0.0.0"
	cfg := &DatabaseEnvConfig{}
	if err := runtime.FillEnvConfig(env, cfg); err != nil {
		t.Fatalf("FillEnvConfig: %v", err)
	}

	if cfg.DatabaseProxyHost != "0.0.0.0" {
		t.Fatalf("DatabaseProxyHost = %q, want 0.0.0.0", cfg.DatabaseProxyHost)
	}
}

func TestTheMessageBusTokenIsReadFromTheEnvironment(t *testing.T) {
	env := requiredEnv()
	env["WOOFX3_MESSAGEBUS_TOKEN"] = "s3cret"
	cfg := &DatabaseEnvConfig{}
	if err := runtime.FillEnvConfig(env, cfg); err != nil {
		t.Fatalf("FillEnvConfig: %v", err)
	}

	if cfg.Config.Token != "s3cret" {
		t.Fatalf("messagebus token = %q, want s3cret", cfg.Config.Token)
	}
}

func TestTheMessageBusTokenIsOptional(t *testing.T) {
	cfg := &DatabaseEnvConfig{}
	if err := runtime.FillEnvConfig(requiredEnv(), cfg); err != nil {
		t.Fatalf("FillEnvConfig: %v", err)
	}

	if cfg.Config.Token != "" {
		t.Fatalf("messagebus token = %q, want none", cfg.Config.Token)
	}
}

func TestHTTPServer(t *testing.T) {
	cases := []struct {
		name    string
		env     DatabaseEnvConfig
		want    HTTPServerConfig
		wantErr bool
	}{
		{name: "defaults when unset", want: DefaultHTTPServerConfig()},
		{
			name: "overrides",
			env: DatabaseEnvConfig{
				DatabaseProxyReadHeaderTimeout: "2s",
				DatabaseProxyReadTimeout:       "10s",
				DatabaseProxyWriteTimeout:      " 1m ",
				DatabaseProxyIdleTimeout:       "5m",
				DatabaseProxyMaxBodyBytes:      1 << 20,
			},
			want: HTTPServerConfig{
				ReadHeaderTimeout: 2 * time.Second,
				ReadTimeout:       10 * time.Second,
				WriteTimeout:      time.Minute,
				IdleTimeout:       5 * time.Minute,
				MaxBodyBytes:      1 << 20,
			},
		},
		{name: "unparseable duration", env: DatabaseEnvConfig{DatabaseProxyReadTimeout: "30"}, wantErr: true},
		{name: "zero duration", env: DatabaseEnvConfig{DatabaseProxyIdleTimeout: "0s"}, wantErr: true},
		{name: "negative duration", env: DatabaseEnvConfig{DatabaseProxyWriteTimeout: "-1s"}, wantErr: true},
		{name: "negative body cap", env: DatabaseEnvConfig{DatabaseProxyMaxBodyBytes: -1}, wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.env.HTTPServer()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("HTTPServer() = %+v, want an error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("HTTPServer(): %v", err)
			}
			if got != tc.want {
				t.Fatalf("HTTPServer() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestAllowedHosts(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  []string
	}{
		{name: "unset", value: "", want: []string{}},
		{name: "one", value: "db", want: []string{"db"}},
		{name: "several with blanks", value: " db , ,proxy.internal,", want: []string{"db", "proxy.internal"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := DatabaseEnvConfig{DatabaseProxyAllowedHosts: tc.value}
			if got := env.AllowedHosts(); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("AllowedHosts() = %q, want %q", got, tc.want)
			}
		})
	}
}
