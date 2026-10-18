package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	WebSocketSameOrigin bool `json:"-"`
	// WebSocketAllowedOrigins, when not empty, admits only upgrades whose
	// Origin is listed. As with WebSocketSameOrigin, no Origin is accepted.
	WebSocketAllowedOrigins []string `json:"-"`
}

// DefaultConfiguration listens on loopback only. Unless a token is
// configured the server has no authentication, and in a shared-network
// deployment anything reachable beyond loopback is reachable by every
// neighbour.
func DefaultConfiguration() *Configuration {
	return &Configuration{
		Host: "127.0.0.1",
	}
}

func (c *Configuration) Load(path string) error {
	if path != "" {
		data, err := os.ReadFile(path)
		if err == nil {
			return json.Unmarshal(data, c)
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
			return json.Unmarshal(data, c)
		}
	}

	return os.ErrNotExist
}

// OverlayFromMap applies the merged environment. It fails on a hardening
// setting it cannot parse rather than starting the server less locked down
// than its operator asked for.
func (c *Configuration) OverlayFromMap(env map[string]string) error {
	if v := env["WOOFX3_MESSAGEBUS_HOST"]; v != "" {
		c.Host = v
	}
	if v := env["WOOFX3_MESSAGEBUS_SERVER_LISTENING_PORT"]; v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			c.Port = p
		}
	}
	if v := env["WOOFX3_MESSAGEBUS_WEBSOCKET_PORT"]; v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			c.WebSocketPort = p
		}
	}
	if v := env["ROOT_PATH"]; v != "" {
		c.RootPath = v
	}
	if v := env["LOG_LEVEL"]; v != "" {
		c.LogLevel = v
	}
	if v := strings.TrimSpace(env["WOOFX3_MESSAGEBUS_TOKEN"]); v != "" {
		c.Token = v
	}
	if err := overlayBool(env, "WOOFX3_MESSAGEBUS_TCP_DISABLED", &c.TCPDisabled); err != nil {
		return err
	}
	if err := overlayBool(env, "WOOFX3_MESSAGEBUS_WEBSOCKET_SAME_ORIGIN", &c.WebSocketSameOrigin); err != nil {
		return err
	}
	if v := strings.TrimSpace(env["WOOFX3_MESSAGEBUS_WEBSOCKET_ALLOWED_ORIGINS"]); v != "" {
		c.WebSocketAllowedOrigins = splitList(v)
	}
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
