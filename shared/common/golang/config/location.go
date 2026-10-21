package config

import (
	"os"
	"path/filepath"
	"strings"
)

// ConfigFileEnv names an explicit config file. It must exist: a deployment that names its config
// file and gets an empty config instead would start with defaults it never asked for.
// Must match CONFIG_FILE_ENV in shared/common/typescript/runtime/config.ts and
// shared/common/rust/runtime/src/lib.rs.
const ConfigFileEnv = "WOOFX3_CONFIG"

// RootDirEnv names the config root directory, holding .env and, unless WOOFX3_CONFIG is set, the
// config file.
const RootDirEnv = "WOOFX3_ROOT"

// FileNames are the config file names read from a config root, in order of preference.
// Must match CONFIG_FILE_NAMES in shared/common/typescript/runtime/config.ts and
// CONFIG_FILE_NAMES in shared/common/rust/runtime/src/lib.rs.
var FileNames = []string{".woofx3.json", ".woofx3.config"}

// Location is where configuration is read from.
type Location struct {
	// RootDir holds .env.
	RootDir string
	// ConfigPath is the JSON config file, or "" when there is none.
	ConfigPath string
	// Required is true when ConfigPath was named by WOOFX3_CONFIG, so a missing file is an error.
	Required bool
	// Searched is true when nothing named the location and it was found by walking up from the
	// working directory, so a caller with a fallback of its own may still apply it.
	Searched bool
}

// ResolveLocation picks the config root and file, first match wins:
//   - rootDir, when not blank: that directory's .env and config file.
//   - WOOFX3_CONFIG: that file; .env from WOOFX3_ROOT if set, else the file's directory.
//   - WOOFX3_ROOT: that directory's .env and config file.
//   - otherwise the nearest directory at or above the working directory holding a config file,
//     else the working directory.
//
// Values are trimmed, blank counts as unset, and paths are made absolute.
func ResolveLocation(rootDir string) Location {
	if root := strings.TrimSpace(rootDir); root != "" {
		root = absOrSelf(root)
		return Location{RootDir: root, ConfigPath: FileIn(root)}
	}
	root := ""
	if v := strings.TrimSpace(os.Getenv(RootDirEnv)); v != "" {
		root = absOrSelf(v)
	}
	if v := strings.TrimSpace(os.Getenv(ConfigFileEnv)); v != "" {
		configPath := absOrSelf(v)
		if root == "" {
			root = filepath.Dir(configPath)
		}
		return Location{RootDir: root, ConfigPath: configPath, Required: true}
	}
	if root != "" {
		return Location{RootDir: root, ConfigPath: FileIn(root)}
	}
	root = FindProjectRoot(".")
	return Location{RootDir: root, ConfigPath: FileIn(root), Searched: true}
}

// FileIn returns the config file in dir, preferring .woofx3.json, or "" when there is none.
func FileIn(dir string) string {
	for _, name := range FileNames {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

// FindProjectRoot walks up from startDir to the first directory holding a config file. Without
// one, it returns startDir, made absolute.
func FindProjectRoot(startDir string) string {
	start := absOrSelf(startDir)
	dir := start
	for {
		if FileIn(dir) != "" {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return start
		}
		dir = parent
	}
}

func absOrSelf(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		return abs
	}
	return path
}
