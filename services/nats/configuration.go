package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Configuration struct {
	Host          string `json:"messagebusHost"`
	Port          int    `json:"messagebusServerListeningPort"`
	WebSocketPort int    `json:"messagebusWebSocketPort"`
	NoLog         bool   `json:"noLog"`
	NoSigs        bool   `json:"noSigs"`
	RootPath      string `json:"rootPath"`
	LogLevel      string `json:"logLevel"`

	// The settings below are read only from the merged environment map (see
	// OverlayFromMap), where a .woofx3.json key arrives as its WOOFX3_
	// variable. That keeps a boolean written as "true" in the file and one set
	// as an environment string parsing the same way.

	// Token, when set, is required from every client on both listeners.
	// Unset, the server accepts anyone who can reach it.
	Token string `json:"-"`
	// TCPDisabled turns off the plain NATS listener, leaving only the
	// WebSocket one that the engine's own clients use.
	TCPDisabled bool `json:"-"`
	// WebSocketSameOrigin rejects a WebSocket upgrade whose Origin header
	// names a different host than the one it was sent to. A request with no
	// Origin header, which is what the engine's own clients send, is accepted.
	// On by default: it is what keeps a web page in any browser on this
	// machine off the bus.
	WebSocketSameOrigin bool `json:"-"`
	// WebSocketAllowedOrigins, when not empty, admits only upgrades whose
	// Origin is listed. As with WebSocketSameOrigin, no Origin is accepted.
	// NATS applies both checks when both are set, so a list only admits a
	// foreign origin with WebSocketSameOrigin turned off.
	WebSocketAllowedOrigins []string `json:"-"`
}

// Listener defaults. DefaultClientPort is NATS's own default for its TCP
// listener; DefaultWebSocketPort must match the port in messagebusUrl in
// build/config/.woofx3.json, which is how the engine's services connect.
const (
	DefaultHost          = "127.0.0.1"
	DefaultClientPort    = 4222
	DefaultWebSocketPort = 4225
)

// DefaultConfiguration listens on loopback only, on fixed ports. In a
// shared-network deployment anything reachable beyond loopback is reachable
// by every neighbour.
func DefaultConfiguration() *Configuration {
	return &Configuration{
		Host:                DefaultHost,
		Port:                DefaultClientPort,
		WebSocketPort:       DefaultWebSocketPort,
		WebSocketSameOrigin: true,
	}
}

// The ways Validate refuses a configuration, for errors.Is.
var (
	ErrPortsCollide       = errors.New("the TCP and WebSocket listeners are set to the same port")
	ErrInvalidOrigin      = errors.New("is not an http(s) origin: write it as scheme://host[:port], with no path")
	ErrOriginsUnreachable = errors.New("messagebusWebSocketAllowedOrigins admits only same-origin pages while messagebusWebSocketSameOrigin is on: set WOOFX3_MESSAGEBUS_WEBSOCKET_SAME_ORIGIN=false to admit the listed origins")
)

// Validate refuses a configuration the server must not start with. Each
// problem is one the operator has to resolve; none has a safe guess.
func (c *Configuration) Validate() error {
	if strings.TrimSpace(c.Host) == "" {
		return errors.New("messagebusHost is blank: a blank host must keep the loopback default")
	}
	if err := checkPort("messagebusServerListeningPort", c.Port); err != nil {
		return err
	}
	if err := checkPort("messagebusWebSocketPort", c.WebSocketPort); err != nil {
		return err
	}
	if !c.TCPDisabled && c.Port == c.WebSocketPort {
		return fmt.Errorf("%w (%d): set messagebusServerListeningPort and messagebusWebSocketPort apart, or disable TCP", ErrPortsCollide, c.Port)
	}
	for _, origin := range c.WebSocketAllowedOrigins {
		if !isHTTPOrigin(origin) {
			return fmt.Errorf("messagebusWebSocketAllowedOrigins entry %q %w", origin, ErrInvalidOrigin)
		}
	}
	if c.WebSocketSameOrigin && len(c.WebSocketAllowedOrigins) > 0 {
		return ErrOriginsUnreachable
	}
	return nil
}

// isHTTPOrigin reports whether origin is written the way a browser sends an
// Origin header: http or https, a host, an optional port, and nothing else.
func isHTTPOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return u.Hostname() != "" && u.User == nil && u.Opaque == "" && u.Path == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == ""
}

func checkPort(key string, port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("%s = %d is not a port number", key, port)
	}
	return nil
}

func (c *Configuration) Load(path string) error {
	if path != "" {
		data, err := os.ReadFile(path)
		if err == nil {
			return c.applyFile(data)
		}
	}

	var execPath string
	var err error
	if isDevelopment() {
		execPath, err = os.Getwd()
	} else {
		execPath, err = os.Executable()
	}
	if err != nil {
		return err
	}
	execDir := filepath.Dir(execPath)

	candidatePaths := []string{
		filepath.Join(execDir, ".woofx3.json"),
		filepath.Join(execDir, "..", ".woofx3.json"),
		filepath.Join(execDir, "..", ".woofx3", ".woofx3.json"),
	}

	for _, p := range candidatePaths {
		if _, statErr := os.Stat(p); statErr == nil {
			data, readErr := os.ReadFile(p)
			if readErr != nil {
				continue
			}
			return c.applyFile(data)
		}
	}

	return os.ErrNotExist
}

// applyFile sets the fields a config file holds. A key whose value is blank
// (null, or a string that is empty once trimmed) is left out, so a "" left in
// a template keeps the default instead of masking it, the same rule
// config.MergeByPrecedence applies between sources.
func (c *Configuration) applyFile(data []byte) error {
	var values map[string]json.RawMessage
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	for key, raw := range values {
		if isBlankJSON(raw) {
			delete(values, key)
		}
	}
	filtered, err := json.Marshal(values)
	if err != nil {
		return err
	}
	return json.Unmarshal(filtered, c)
}

func isBlankJSON(raw json.RawMessage) bool {
	var text *string
	if err := json.Unmarshal(raw, &text); err != nil {
		// Not a string: a number, boolean, array or object is a value.
		return false
	}
	return text == nil || strings.TrimSpace(*text) == ""
}

// The WOOFX3_MESSAGEBUS_* keys the server reads. A config file key arrives as
// its variable: messagebusWebSocketSameOrigin as
// WOOFX3_MESSAGEBUS_WEB_SOCKET_SAME_ORIGIN, which canonicalKey folds into
// WOOFX3_MESSAGEBUS_WEBSOCKET_SAME_ORIGIN.
const (
	envHost                    = "WOOFX3_MESSAGEBUS_HOST"
	envListeningPort           = "WOOFX3_MESSAGEBUS_SERVER_LISTENING_PORT"
	envWebSocketPort           = "WOOFX3_MESSAGEBUS_WEBSOCKET_PORT"
	envToken                   = "WOOFX3_MESSAGEBUS_TOKEN"
	envTCPDisabled             = "WOOFX3_MESSAGEBUS_TCP_DISABLED"
	envWebSocketSameOrigin     = "WOOFX3_MESSAGEBUS_WEBSOCKET_SAME_ORIGIN"
	envWebSocketAllowedOrigins = "WOOFX3_MESSAGEBUS_WEBSOCKET_ALLOWED_ORIGINS"
)

const messagebusPrefix = "WOOFX3_MESSAGEBUS_"

// knownMessagebusKeys are every WOOFX3_MESSAGEBUS_* key that may appear in the
// shared config. Any other one fails startup: a misspelt hardening key would
// otherwise leave that hardening silently off.
var knownMessagebusKeys = map[string]bool{
	envHost:                    true,
	envListeningPort:           true,
	envWebSocketPort:           true,
	envToken:                   true,
	envTCPDisabled:             true,
	envWebSocketSameOrigin:     true,
	envWebSocketAllowedOrigins: true,
	// Read by the message bus clients from the same config, not by the server.
	"WOOFX3_MESSAGEBUS_URL":      true,
	"WOOFX3_MESSAGEBUS_JWT":      true,
	"WOOFX3_MESSAGEBUS_NKEY":     true,
	"WOOFX3_MESSAGEBUS_N_KEY":    true,
	"WOOFX3_MESSAGEBUS_NKEYSEED": true,
	"WOOFX3_MESSAGEBUS_NAME":     true,
	// Written to a worktree's ports.env, which a developer's shell may source.
	"WOOFX3_MESSAGEBUS_PORT": true,
}

// canonicalKey folds the spellings of one message bus key together. A config
// file key's camelCase decides its variable name, so messageBusX and
// messagebusWebSocketX arrive split where the documented variables are not;
// the server's JSON fields already match them case-insensitively.
func canonicalKey(key string) string {
	key = strings.Replace(key, "WOOFX3_MESSAGE_BUS_", messagebusPrefix, 1)
	return strings.Replace(key, messagebusPrefix+"WEB_SOCKET_", messagebusPrefix+"WEBSOCKET_", 1)
}

// canonicalSource renames a source's keys with canonicalKey. Two non-blank
// spellings of one key in the same source must agree, since neither outranks
// the other; a blank one means "not set here", as when sources are merged.
func canonicalSource(source map[string]string) (map[string]string, error) {
	out := make(map[string]string, len(source))
	for key, value := range source {
		canonical := canonicalKey(key)
		existing, present := out[canonical]
		switch {
		case !present || strings.TrimSpace(existing) == "":
			out[canonical] = value
		case strings.TrimSpace(value) == "" || value == existing:
			// The value already there stands.
		default:
			return nil, fmt.Errorf("%s is set twice with different values (%q and %q)", canonical, existing, value)
		}
	}
	return out, nil
}

// checkMessagebusKeys fails on a WOOFX3_MESSAGEBUS_* key the engine does not
// know, naming every one.
func checkMessagebusKeys(env map[string]string) error {
	var unknown []string
	for key := range env {
		if strings.HasPrefix(key, messagebusPrefix) && !knownMessagebusKeys[key] {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	sort.Strings(unknown)
	return fmt.Errorf("unknown message bus setting %s (config file keys arrive as their WOOFX3_ variable)", strings.Join(unknown, ", "))
}

// OverlayFromMap applies the merged environment, keyed canonically (see
// canonicalKey). It fails on a setting it does not know or cannot parse
// rather than starting the server less locked down, or on another port, than
// its operator asked for.
func (c *Configuration) OverlayFromMap(env map[string]string) error {
	if err := checkMessagebusKeys(env); err != nil {
		return err
	}
	if v := strings.TrimSpace(env[envHost]); v != "" {
		c.Host = v
	}
	if err := overlayPort(env, envListeningPort, &c.Port); err != nil {
		return err
	}
	if err := overlayPort(env, envWebSocketPort, &c.WebSocketPort); err != nil {
		return err
	}
	if v := env["ROOT_PATH"]; v != "" {
		c.RootPath = v
	}
	if v := env["LOG_LEVEL"]; v != "" {
		c.LogLevel = v
	}
	if v := strings.TrimSpace(env[envToken]); v != "" {
		c.Token = v
	}
	if err := overlayBool(env, envTCPDisabled, &c.TCPDisabled); err != nil {
		return err
	}
	if err := overlayBool(env, envWebSocketSameOrigin, &c.WebSocketSameOrigin); err != nil {
		return err
	}
	if v := strings.TrimSpace(env[envWebSocketAllowedOrigins]); v != "" {
		c.WebSocketAllowedOrigins = splitList(v)
	}
	return nil
}

func overlayPort(env map[string]string, key string, target *int) error {
	v := strings.TrimSpace(env[key])
	if v == "" {
		return nil
	}
	port, err := strconv.Atoi(v)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("%s = %q is not a port number", key, v)
	}
	*target = port
	return nil
}

func overlayBool(env map[string]string, key string, target *bool) error {
	v := strings.TrimSpace(env[key])
	if v == "" {
		return nil
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fmt.Errorf("%s = %q is not a boolean", key, v)
	}
	*target = parsed
	return nil
}

// splitList reads a comma-separated list, dropping blank entries.
func splitList(v string) []string {
	var out []string
	for _, item := range strings.Split(v, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// reachableWithoutToken reports whether the server would accept anyone from
// beyond this machine: it binds a non-loopback host and requires no token.
func reachableWithoutToken(host string, token string) bool {
	if strings.TrimSpace(token) != "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return false
	}
	ip := net.ParseIP(host)
	return ip == nil || !ip.IsLoopback()
}
