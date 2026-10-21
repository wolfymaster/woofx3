package config

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/runtime"
)

// requiredEnv is the minimum DatabaseEnvConfig accepts.
func requiredEnv() map[string]string {
	return map[string]string{
		"WOOFX3_DATABASE_URL":   "sqlite://./data/test.db",
		"WOOFX3_STORAGE_PATH":   "./data/module-storage.db",
		"WOOFX3_SECRETS_KEY":    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		"WOOFX3_MESSAGEBUS_URL": "ws://127.0.0.1:4225",
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
