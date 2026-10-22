package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/wolfymaster/woofx3/clients/nats"
)

type DatabaseEnvConfig struct {
	DatabaseURL string `env:"WOOFX3_DATABASE_URL,required"`
	// StoragePath is the SQLite file that holds module storage (`ctx.storage`).
	StoragePath string `env:"WOOFX3_STORAGE_PATH,required"`
	// StorageReplicaURL, when set, streams module storage to S3-compatible
	// object storage with Litestream and restores it from there when the file
	// is missing. Unset is local mode: the file on disk is the only copy.
	StorageReplicaURL string `env:"WOOFX3_STORAGE_REPLICA_URL"`
	// S3 credentials for the replica. When unset, the standard AWS credential
	// sources (AWS_ACCESS_KEY_ID, ...) apply.
	StorageReplicaAccessKeyID     string `env:"WOOFX3_STORAGE_REPLICA_ACCESS_KEY_ID"`
	StorageReplicaSecretAccessKey string `env:"WOOFX3_STORAGE_REPLICA_SECRET_ACCESS_KEY"`
	DatabaseProxyPort             string `env:"WOOFX3_DATABASE_PROXY_PORT,default=8080"`
	// DatabaseProxyHost is the interface db-proxy listens on. It stays on
	// loopback unless a deployment runs its clients in separate network
	// namespaces and says otherwise.
	DatabaseProxyHost string `env:"WOOFX3_DATABASE_PROXY_HOST,default=127.0.0.1"`
	// DbProxyToken is the service token every caller sends as
	// `Authorization: Bearer <token>`. The orchestrator generates it on first
	// run and hands it to every service it starts.
	DbProxyToken string `env:"WOOFX3_DB_PROXY_TOKEN,required"`
	// DatabaseProxyAllowedHosts is a comma-separated list of Host header
	// names accepted besides loopback ones, for clients that reach db-proxy
	// by a service name (docker compose). A browser page that rebinds its own
	// domain to 127.0.0.1 still sends that domain, so it is refused.
	DatabaseProxyAllowedHosts string `env:"WOOFX3_DATABASE_PROXY_ALLOWED_HOSTS"`
	// HTTP server limits. Each is a Go duration (or a byte count) and unset
	// means the default in DefaultHTTPServerConfig.
	DatabaseProxyReadHeaderTimeout string `env:"WOOFX3_DATABASE_PROXY_READ_HEADER_TIMEOUT"`
	DatabaseProxyReadTimeout       string `env:"WOOFX3_DATABASE_PROXY_READ_TIMEOUT"`
	DatabaseProxyWriteTimeout      string `env:"WOOFX3_DATABASE_PROXY_WRITE_TIMEOUT"`
	DatabaseProxyIdleTimeout       string `env:"WOOFX3_DATABASE_PROXY_IDLE_TIMEOUT"`
	DatabaseProxyMaxBodyBytes      int64  `env:"WOOFX3_DATABASE_PROXY_MAX_BODY_BYTES"`
	LogLevel                       string `env:"WOOFX3_LOG_LEVEL"`
	// SecretsKey seals `secret` module settings at rest: a base64-encoded
	// 32-byte key. Injected like any other config so every instance shares it.
	SecretsKey string `env:"WOOFX3_SECRETS_KEY,required"`
	nats.Config
}

// HTTPServerConfig bounds how long db-proxy's HTTP server waits on a client
// and how large a request body it reads.
type HTTPServerConfig struct {
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	MaxBodyBytes      int64
}

const (
	DefaultReadHeaderTimeout = 5 * time.Second
	DefaultReadTimeout       = 30 * time.Second
	DefaultWriteTimeout      = 60 * time.Second
	DefaultIdleTimeout       = 120 * time.Second
	// DefaultMaxBodyBytes leaves wide room over the largest bodies callers
	// send: the bundled woofx3 module manifest is about 64 KiB, and a module
	// storage value is capped by the sandbox well below this.
	DefaultMaxBodyBytes int64 = 8 << 20
)

// DefaultHTTPServerConfig is the HTTP server configuration with every limit
// at its default.
func DefaultHTTPServerConfig() HTTPServerConfig {
	return HTTPServerConfig{
		ReadHeaderTimeout: DefaultReadHeaderTimeout,
		ReadTimeout:       DefaultReadTimeout,
		WriteTimeout:      DefaultWriteTimeout,
		IdleTimeout:       DefaultIdleTimeout,
		MaxBodyBytes:      DefaultMaxBodyBytes,
	}
}

// HTTPServer is DefaultHTTPServerConfig with the configured overrides
// applied. A value that does not parse, or is not positive, is an error so a
// typo fails the start rather than removing a limit.
func (c *DatabaseEnvConfig) HTTPServer() (HTTPServerConfig, error) {
	server := DefaultHTTPServerConfig()
	durations := []struct {
		env   string
		value string
		dest  *time.Duration
	}{
		{"WOOFX3_DATABASE_PROXY_READ_HEADER_TIMEOUT", c.DatabaseProxyReadHeaderTimeout, &server.ReadHeaderTimeout},
		{"WOOFX3_DATABASE_PROXY_READ_TIMEOUT", c.DatabaseProxyReadTimeout, &server.ReadTimeout},
		{"WOOFX3_DATABASE_PROXY_WRITE_TIMEOUT", c.DatabaseProxyWriteTimeout, &server.WriteTimeout},
		{"WOOFX3_DATABASE_PROXY_IDLE_TIMEOUT", c.DatabaseProxyIdleTimeout, &server.IdleTimeout},
	}
	for _, d := range durations {
		value := strings.TrimSpace(d.value)
		if value == "" {
			continue
		}
		parsed, err := time.ParseDuration(value)
		if err != nil {
			return HTTPServerConfig{}, fmt.Errorf("%s: %w", d.env, err)
		}
		if parsed <= 0 {
			return HTTPServerConfig{}, fmt.Errorf("%s must be positive, got %s", d.env, value)
		}
		*d.dest = parsed
	}
	switch {
	case c.DatabaseProxyMaxBodyBytes < 0:
		return HTTPServerConfig{}, fmt.Errorf("WOOFX3_DATABASE_PROXY_MAX_BODY_BYTES must be positive, got %d", c.DatabaseProxyMaxBodyBytes)
	case c.DatabaseProxyMaxBodyBytes > 0:
		server.MaxBodyBytes = c.DatabaseProxyMaxBodyBytes
	}
	return server, nil
}

// AllowedHosts is DatabaseProxyAllowedHosts split on commas, trimmed, with
// blank entries dropped.
func (c *DatabaseEnvConfig) AllowedHosts() []string {
	hosts := []string{}
	for _, host := range strings.Split(c.DatabaseProxyAllowedHosts, ",") {
		host = strings.TrimSpace(host)
		if host != "" {
			hosts = append(hosts, host)
		}
	}
	return hosts
}

// Casbin model for command/resource authorization. This governs whether a
// given actor (a chat username, or "group:<groupId>" for a group grant) may
// perform an action on a resource (e.g. "command/<name>"). It is NOT used to
// gate access to the api service's HTTP endpoints - that has its own
// token-based auth. g(user, group) is Casbin's built-in RBAC role resolution;
// keyMatch2 keeps "command/*"-style wildcard grants working.
//
// The p.sub == "*" clause is how "every user" is expressed. Two cases need it,
// and neither can be represented with g() rows: the built-in "everyone" group
// (materialising one membership row per chatter would be unbounded and would
// go stale constantly), and a restricted command with no group or user grant
// configured, which means "no restriction" rather than "deny all". Putting it
// in the matcher keeps both enforcement paths - db-proxy's GetCommand hook and
// woofwoofwoof's canUse -> HasPermission - agreeing without either of them
// special-casing it in application code.
func GetCasbinModelString() (string, error) {
	return `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = (p.sub == "*" || g(r.sub, p.sub) || r.sub == p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act
`, nil
}
