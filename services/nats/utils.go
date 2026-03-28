package main

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
)

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
