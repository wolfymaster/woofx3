package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/wolfymaster/woofx3/common/logging"
)

func main() {
	confPath := readFlags()
	cfg, err := loadConfiguration(confPath)
	if err != nil {
		// The logger needs the configured root path, so a config failure can
		// only be reported on stderr.
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	sharedLogger, err := logging.New(logging.Config{
		ServiceName:  "nats",
		Level:        parseLogLevel(cfg.LogLevel),
		LogDirectory: strings.TrimSpace(cfg.RootPath) + "/logs",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer sharedLogger.Close()
	logger := sharedLogger.Slog()

	// The embedded NATS server and any library code reaching for the stdlib
	// default logger route through the shared transports as well.
	slog.SetDefault(logger)

	if cfg.Token == "" {
		logger.Warn("NATS RUNS WITHOUT AUTHENTICATION (WOOFX3_MESSAGEBUS_ALLOW_UNAUTHENTICATED=true): any process that can reach it can read and publish every engine message, including requests for the Twitch token; set WOOFX3_MESSAGEBUS_TOKEN instead",
			"host", cfg.Host,
			"reachable_beyond_loopback", !isLoopbackHost(cfg.Host))
	}

	ns, err := createServer(cfg, logger)
	if err != nil {
		fatalExit(sharedLogger, "Failed to create server", "error", err)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	gracefulShutdown(ns)
}

func readFlags() string {
	confPath := flag.String("conf", "", "Path to .woofx3.json (or .woofx3.config) config file; defaults to project root if unset")
	flag.Parse()
	return *confPath
}

func loadConfiguration(confPath string) (*Configuration, error) {
	cfg, err := LoadConfig(confPath)
	if err != nil {
		return nil, err
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if cfg.RootPath == "" {
		return nil, &configError{msg: "rootPath must be set"}
	}
	stat, err := os.Stat(cfg.RootPath)
	if err != nil {
		return nil, err
	}
	if !stat.IsDir() {
		return nil, &configError{msg: "rootPath is not a valid directory", rootPath: cfg.RootPath}
	}
	return cfg, nil
}

type configError struct {
	msg      string
	rootPath string
}

func (e *configError) Error() string {
	if e.rootPath != "" {
		return e.msg + ": " + e.rootPath
	}
	return e.msg
}

func createServer(cfg *Configuration, logger *slog.Logger) (*server.Server, error) {
	opts := &server.Options{
		// The client (TCP) listener binds the same host as the WebSocket one;
		// left unset, NATS binds it on every interface.
		Host:   cfg.Host,
		Port:   cfg.Port,
		NoLog:  cfg.NoLog,
		NoSigs: cfg.NoSigs,
		// Without a WebSocket auth block of its own, the WebSocket listener
		// requires the same token as the TCP one.
		Authorization: cfg.Token,
		DontListen:    cfg.TCPDisabled,
		Websocket: server.WebsocketOpts{
			Host:           cfg.Host,
			Port:           cfg.WebSocketPort,
			NoTLS:          true,
			SameOrigin:     cfg.WebSocketSameOrigin,
			AllowedOrigins: cfg.WebSocketAllowedOrigins,
		},
	}
	ns, err := server.NewServer(opts)
	if err != nil {
		return nil, err
	}
	go ns.Start()
	if !ns.ReadyForConnections(5 * time.Second) {
		return nil, &configError{msg: "NATS server not ready within timeout"}
	}
	logger.Info("NATS server started",
		"host", opts.Host,
		"port", opts.Port,
		"tcp_disabled", opts.DontListen,
		"websocket_port", opts.Websocket.Port,
		"token_required", opts.Authorization != "",
		"websocket_same_origin", opts.Websocket.SameOrigin,
		"websocket_allowed_origins", opts.Websocket.AllowedOrigins,
	)
	return ns, nil
}

func gracefulShutdown(ns *server.Server) {
	ns.Shutdown()
	os.Exit(0)
}
