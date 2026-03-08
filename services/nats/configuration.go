package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
)

type Configuration struct {
	Host          string `json:"messageBusHost"`
	Port          int    `json:"messageBusServerListeningPort"`
	WebSocketPort int    `json:"messageBusWebSocketPort"`
	NoLog         bool   `json:"noLog"`
	NoSigs        bool   `json:"noSigs"`
	RootPath      string `json:"rootPath"`
	LogLevel      string `json:"logLevel"`
}

func DefaultConfiguration() *Configuration {
	return &Configuration{
		Host: "0.0.0.0",
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
		filepath.Join(execDir, "conf.json"),
		filepath.Join(execDir, "..", "conf.json"),
		filepath.Join(execDir, "..", "conf", "conf.json"),
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

func (c *Configuration) OverlayFromMap(env map[string]string) {
	if v := env["MESSAGE_BUS_HOST"]; v != "" {
		c.Host = v
	}
	if v := env["MESSAGE_BUS_SERVER_LISTENING_PORT"]; v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			c.Port = p
		}
	}
	if v := env["MESSAGE_BUS_WEBSOCKET_PORT"]; v != "" {
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
}
