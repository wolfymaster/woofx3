package main

import (
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nats-io/nats-server/v2/server"
)

func main() {
	confPath := readFlags()
	cfg, err := loadConfiguration(confPath)
	if err != nil {
		fatalExit("Failed to load configuration", "error", err)
	}

	level := parseLogLevel(cfg.LogLevel)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	host, wsPort, err := findPort(cfg)
	if err != nil {
		fatalExit("Failed to resolve ports", "error", err)
	}

	ns, err := createServer(cfg, host, wsPort)
	if err != nil {
		fatalExit("Failed to create server", "error", err)
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

func createServer(cfg *Configuration, host string, wsPort int) (*server.Server, error) {
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
	slog.Info("NATS server started", "host", opts.Host, "websocket_port", opts.Websocket.Port)
	return ns, nil
}

func gracefulShutdown(_ *Configuration, ns *server.Server) {
	// cleanupPIDFile(cfg.RootPath)
	ns.Shutdown()
	os.Exit(0)
}
