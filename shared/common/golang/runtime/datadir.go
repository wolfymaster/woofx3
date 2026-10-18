package runtime

import (
	"os"
	"path/filepath"
	"strings"
)

// DataDirEnv names the directory that holds everything an engine writes:
// databases, module storage, uploaded modules, caches and logs. It is read
// from the process environment only, never from .woofx3.json, so every
// service and the orchestrator that starts them agree on it.
// Must match dataDirEnv in shared/common/golang/logging/config.go,
// DATA_DIR_ENV in shared/common/typescript/runtime/data-dir.ts and
// DATA_DIR_ENV in shared/common/rust/runtime/src/lib.rs.
const DataDirEnv = "WOOFX3_DATA_DIR"

// DataDir returns the absolute data directory, or "" when WOOFX3_DATA_DIR is
// unset or blank.
func DataDir() string {
	dir := strings.TrimSpace(os.Getenv(DataDirEnv))
	if dir == "" {
		return ""
	}
	if abs, err := filepath.Abs(dir); err == nil {
		return abs
	}
	return dir
}

// ResolveDataPath anchors a relative path in the data directory. Without a
// data directory, or for an absolute path, the path comes back unchanged, and
// a relative one is then resolved against the working directory.
func ResolveDataPath(path string) string {
	return resolveDataPathIn(DataDir(), path)
}

func resolveDataPathIn(dataDir string, path string) string {
	if dataDir == "" || path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(dataDir, path)
}
