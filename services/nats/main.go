package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/nats-io/nats-server/v2/server"
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

func findAvailablePort(host string, preferred []int) (int, error) {
	try := func(p int) bool {
		l, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, p))
		if err != nil {
			return false
		}
		_ = l.Close()
		return true
	}

	for _, p := range preferred {
		if try(p) {
			return p, nil
		}
	}

	for p := 4222; p < 65535; p++ {
		if try(p) {
			return p, nil
		}
	}
	return 0, fmt.Errorf("no available port found")
}

func getPIDPath(rootPath string) string {
	return filepath.Join(rootPath, "pids", "NATS.pid")
}

func writePIDFile(rootPath string, port int) error {
	pidsDir := filepath.Join(rootPath, "pids")
	if err := os.MkdirAll(pidsDir, 0o755); err != nil {
		return err
	}
	pidPath := getPIDPath(rootPath)
	return os.WriteFile(pidPath, []byte(strconv.Itoa(port)), 0o644)
}

func cleanupPIDFile(rootPath string) {
	pidPath := getPIDPath(rootPath)
	_ = os.Remove(pidPath)
}

func isDevelopment() bool {
	env := os.Getenv("GO_ENV")
	return env == "development" || env == "dev"
}

func (c *Configuration) Load(path string) error {
	// If an explicit path is provided, attempt to read it as-is (relative or absolute)
	if path != "" {
		data, err := os.ReadFile(path)
		if err == nil {
			return json.Unmarshal(data, c)
		}
		// If explicit path fails, continue to fallback search
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

func parseLogLevel(lvl string) slog.Level {
	switch lvl {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	case "info", "":
		fallthrough
	default:
		return slog.LevelInfo
	}
}

func fatalExit(msg string, args ...any) {
	slog.Error(msg, args...)
	os.Exit(1)
}

func main() {
	confPath := flag.String("conf", "", "Path to configuration JSON file")
	flag.Parse()

	var cfg Configuration
	if err := cfg.Load(*confPath); err != nil {
		logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
		slog.SetDefault(logger)
		fatalExit("Failed to load configuration", "error", err)
	}

	level := parseLogLevel(cfg.LogLevel)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	// Validate rootPath exists and is a directory
	if cfg.RootPath == "" {
		fatalExit("Configuration error: rootPath must be set")
	}
	stat, err := os.Stat(cfg.RootPath)
	if err != nil || !stat.IsDir() {
		fatalExit("Configuration error: rootPath is not a valid directory", "rootPath", cfg.RootPath, "error", err)
	}

	host := cfg.Host
	if host == "" {
		host = "0.0.0.0"
	}

	var port int
	if cfg.Port > 0 {
		port = cfg.Port
	} else {
		preferred := []int{9653, 19653, 4222, 16942}
		port, err = findAvailablePort(host, preferred)
		if err != nil {
			fatalExit("Failed to find available port", "error", err)
		}
	}

	// Determine WebSocket port (default to port + 1, or use configured value)
	wsPort := cfg.WebSocketPort
	if wsPort <= 0 {
		// Try to find an available port near the main port
		preferredWSPorts := []int{9653, 19653, 4222, 16942} // []int{port + 1, port + 100, 8080, 9222}
		wsPort, err = findAvailablePort(host, preferredWSPorts)
		if err != nil {
			// Fallback: use the same port (NATS can handle both on same port with proper config)
			wsPort = port
		}
	}

	if err := writePIDFile(cfg.RootPath, port); err != nil {
		fatalExit("Failed to write PID file", "error", err)
	}

	// Configure embedded NATS server
	opts := &server.Options{
		// Host:   host,
		// Port:   port,
		NoLog:  cfg.NoLog,
		NoSigs: cfg.NoSigs, // Don't handle signals (let your app do it)
		Websocket: server.WebsocketOpts{
			Host:  host,
			Port:  wsPort,
			NoTLS: true, // Set to false and configure TLS for production
		},
	}

	// Start embedded NATS server
	ns, err := server.NewServer(opts)
	if err != nil {
		fatalExit("Error creating NATS server", "error", err)
	}

	go ns.Start()
	if !ns.ReadyForConnections(5 * time.Second) {
		fatalExit("NATS server not ready")
	}
	slog.Info("NATS server started", "host", opts.Host, "websocket_port", opts.Websocket.Port)

	// Handle cleanup on exit signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		cleanupPIDFile(cfg.RootPath)
		if ns != nil {
			ns.Shutdown()
		}
		os.Exit(0)
	}()

	// Keep app running
	select {}
}
