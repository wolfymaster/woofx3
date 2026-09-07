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

	host, wsPort, err := findPort(cfg)
	if err != nil {
		fatalExit(sharedLogger, "Failed to resolve ports", "error", err)
	}

	ns, err := createServer(cfg, logger, host, wsPort)
	if err != nil {
		fatalExit(sharedLogger, "Failed to create server", "error", err)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	gracefulShutdown(cfg, ns)
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

func findPort(cfg *Configuration) (host string, wsPort int, err error) {
	host = cfg.Host
	if host == "" {
		host = "0.0.0.0"
	}

	if cfg.WebSocketPort > 0 {
		wsPort = cfg.WebSocketPort
	} else {
		preferredWSPorts := []int{4222}
		wsPort, err = findAvailablePort(host, preferredWSPorts)
		if err != nil {
			return "", 0, err
		}
	}

	// if err := writePIDFile(cfg.RootPath, wsPort); err != nil {
	// 	return "", 0, err
	// }
	return host, wsPort, nil
}

func createServer(cfg *Configuration, logger *slog.Logger, host string, wsPort int) (*server.Server, error) {
	opts := &server.Options{
		NoLog:  cfg.NoLog,
		NoSigs: cfg.NoSigs,
		Websocket: server.WebsocketOpts{
			Host:  host,
			Port:  wsPort,
			NoTLS: true,
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
	logger.Info("NATS server started", "host", opts.Host, "websocket_port", opts.Websocket.Port)
	return ns, nil
}

func gracefulShutdown(_ *Configuration, ns *server.Server) {
	// cleanupPIDFile(cfg.RootPath)
	ns.Shutdown()
	os.Exit(0)
}
