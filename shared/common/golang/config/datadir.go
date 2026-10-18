package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DataDirEnv names the directory that holds everything an engine writes:
// databases, module storage, uploaded modules, caches and logs. It is read
// from the process environment only, never from the config file, so every
// service and the orchestrator that starts them agree on it.
// Must match DATA_DIR_ENV in shared/common/typescript/runtime/data-dir.ts and
// DATA_DIR_ENV in shared/common/rust/runtime/src/lib.rs.
const DataDirEnv = "WOOFX3_DATA_DIR"

// CheckDataDir fails when WOOFX3_DATA_DIR is set to a relative path. Each
// process would resolve it against its own working directory, and the
// orchestrator and the services it starts do not share one, so they would
// write to different places. Load calls it, so a service whose config loads
// has a usable DataDir.
func CheckDataDir() error {
	dir := strings.TrimSpace(os.Getenv(DataDirEnv))
	if dir != "" && !filepath.IsAbs(dir) {
		return fmt.Errorf("%s must be an absolute path, not %q", DataDirEnv, dir)
	}
	return nil
}

// DataDir returns the data directory, or "" when WOOFX3_DATA_DIR is unset or
// blank. See CheckDataDir for a relative value.
func DataDir() string {
	dir := strings.TrimSpace(os.Getenv(DataDirEnv))
	if dir == "" {
		return ""
	}
	return absOrSelf(dir)
}

// ResolveDataPath anchors a relative path in the data directory. Without a
// data directory, or for an absolute path, the path comes back unchanged, and
// a relative one is then resolved against the working directory.
func ResolveDataPath(path string) string {
	return ResolveDataPathIn(DataDir(), path)
}

// ResolveDataPathIn is ResolveDataPath against an explicit data directory,
// where "" means none.
func ResolveDataPathIn(dataDir string, path string) string {
	if dataDir == "" || path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(dataDir, path)
}
