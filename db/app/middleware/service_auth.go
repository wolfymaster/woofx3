package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/twitchtv/twirp"

	commonconfig "github.com/wolfymaster/woofx3/common/config"
)

// ServiceTokenConfigKey is the .woofx3.json key of the db-proxy service
// token; its variable is WOOFX3_DB_PROXY_TOKEN.
const ServiceTokenConfigKey = "dbProxyToken"

const bearerPrefix = "bearer "

// loopbackHostName is the Host header name that always reaches db-proxy on
// this machine. IP literals are checked with net.IP.IsLoopback instead.
const loopbackHostName = "localhost"

// ServiceAuth admits a request only when it names an allowed host and carries
// the engine's db-proxy service token.
//
// The Host check comes first and stands against DNS rebinding: a web page
// that points its own domain at 127.0.0.1 still sends that domain as Host, so
// it is refused before the token is even considered.
type ServiceAuth struct {
	tokenDigest  [sha256.Size]byte
	allowedHosts map[string]struct{}
	logger       *slog.Logger
}

// NewServiceAuth checks token against the shared secret rule and returns the
// middleware. allowedHosts are Host names accepted besides loopback ones.
func NewServiceAuth(token string, allowedHosts []string, logger *slog.Logger) (*ServiceAuth, error) {
	if err := commonconfig.ValidateSecret(ServiceTokenConfigKey, token); err != nil {
		return nil, err
	}
	if logger == nil {
		return nil, errors.New("service auth: logger is nil")
	}
	hosts := make(map[string]struct{}, len(allowedHosts))
	for _, host := range allowedHosts {
		normalized := normalizeHost(host)
		if normalized == "" {
			return nil, fmt.Errorf("service auth: allowed host %q is blank", host)
		}
		hosts[normalized] = struct{}{}
	}
	return &ServiceAuth{
		tokenDigest:  sha256.Sum256([]byte(strings.TrimSpace(token))),
		allowedHosts: hosts,
		logger:       logger,
	}, nil
}

// Wrap returns next behind the Host and token checks. A refusal is written as
// a Twirp error, so every Twirp client decodes it like any other failure.
func (a *ServiceAuth) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.hostAllowed(r.Host) {
			a.refuse(w, r, twirp.PermissionDenied.Error("host not allowed"), "host not allowed")
			return
		}
		if !a.tokenMatches(r.Header.Get("Authorization")) {
			a.refuse(w, r, twirp.Unauthenticated.Error("missing or invalid service token"), "missing or invalid service token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *ServiceAuth) refuse(w http.ResponseWriter, r *http.Request, twerr twirp.Error, reason string) {
	a.logger.Warn("Refused db-proxy request",
		"reason", reason,
		"path", r.URL.Path,
		"host", r.Host,
		"remote_addr", r.RemoteAddr,
	)
	if err := twirp.WriteError(w, twerr); err != nil {
		a.logger.Warn("Failed to write refusal", "error", err)
	}
}

func (a *ServiceAuth) hostAllowed(hostHeader string) bool {
	host := normalizeHost(hostHeader)
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	if host == loopbackHostName {
		return true
	}
	_, ok := a.allowedHosts[host]
	return ok
}

// tokenMatches compares digests so the comparison takes the same time
// whatever the length of the presented token.
func (a *ServiceAuth) tokenMatches(authorization string) bool {
	if len(authorization) < len(bearerPrefix) || !strings.EqualFold(authorization[:len(bearerPrefix)], bearerPrefix) {
		return false
	}
	presented := strings.TrimSpace(authorization[len(bearerPrefix):])
	if presented == "" {
		return false
	}
	digest := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(digest[:], a.tokenDigest[:]) == 1
}

// normalizeHost is a Host header (or an allow-list entry) without its port,
// IPv6 brackets or trailing dot, in lower case.
func normalizeHost(value string) string {
	host := strings.TrimSpace(value)
	if split, _, err := net.SplitHostPort(host); err == nil {
		host = split
	}
	host = strings.TrimPrefix(host, "[")
	host = strings.TrimSuffix(host, "]")
	host = strings.TrimSuffix(host, ".")
	return strings.ToLower(host)
}
