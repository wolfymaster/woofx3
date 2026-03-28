package runtime

import (
	"bufio"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func camelToScreamingSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			b.WriteByte('_')
		}
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r - 32)
		} else if r >= 'A' && r <= 'Z' || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// projectRootMarkers are files that indicate a directory is a project root (config or module root).
// First directory (walking up from startDir) that contains any of these is returned.
// Order does not matter; we only need one marker present.
var projectRootMarkers = []string{".woofx3.config", ".woofx3.json"}

func findProjectRoot(startDir string) string {
	dir, err := filepath.Abs(startDir)
	if err != nil {
		return startDir
	}
	root := filepath.VolumeName(dir) + string(filepath.Separator)
	if root == string(filepath.Separator) {
		root = "/"
	}
	for dir != root {
		for _, name := range projectRootMarkers {
			if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return startDir
}

func parseDotenv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	out := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		}
		out[key] = value
	}
	return out, scanner.Err()
}

func loadWoofx3Config(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// LoadRuntimeEnvOptions configures where to load from. The loader never writes to the process environment.
type LoadRuntimeEnvOptions struct {
	// RootDir, if set, is the directory for .env and .woofx3.config. If empty, WOOFX3_ROOT then findProjectRoot are used.
	RootDir string
}

// resolveRootDir returns the config root directory: options.RootDir if set, else WOOFX3_ROOT from the environment
// if set, else findProjectRoot("."). Paths from options or env are made absolute when possible.
func resolveRootDir(options *LoadRuntimeEnvOptions) string {
	if options != nil && options.RootDir != "" {
		if abs, err := filepath.Abs(options.RootDir); err == nil {
			return abs
		}
		return options.RootDir
	}
	if v := os.Getenv("WOOFX3_ROOT"); v != "" {
		if abs, err := filepath.Abs(v); err == nil {
			return abs
		}
		return v
	}
	return findProjectRoot(".")
}

func LoadRuntimeEnv(options *LoadRuntimeEnvOptions) (map[string]string, error) {
	rootDir := resolveRootDir(options)

	env := make(map[string]string)
	for _, e := range os.Environ() {
		idx := strings.Index(e, "=")
		if idx > 0 {
			env[e[:idx]] = e[idx+1:]
		}
	}

	envPath := filepath.Join(rootDir, ".env")
	dotenv, err := parseDotenv(envPath)
	if err != nil {
		return nil, err
	}
	maps.Copy(env, dotenv)

	configPath := filepath.Join(rootDir, ".woofx3.json")
	woofx3, err := loadWoofx3Config(configPath)
	if err != nil {
		return nil, err
	}
	for key, val := range woofx3 {
		envKey := "WOOFX3_" + camelToScreamingSnake(key)
		env[envKey] = valueToString(val)
	}

	return env, nil
}

func ValidateRequiredEnv(env map[string]string, required []string) []string {
	var missing []string
	for _, key := range required {
		v := env[key]
		if strings.TrimSpace(v) == "" {
			missing = append(missing, key)
		}
	}
	return missing
}

func valueToString(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(v)
	}
}
