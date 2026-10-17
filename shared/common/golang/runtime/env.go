package runtime

import (
	"bufio"
	"encoding/json"
	"fmt"
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
	// RootDir, if set, is the directory for .env and .woofx3.json, and WOOFX3_ROOT and WOOFX3_CONFIG are
	// ignored. If empty, see resolveConfigLocation.
	RootDir string
}

// ConfigFileEnv names an explicit config file. It must exist: a deployment that names its config
// file and gets an empty config instead would start with defaults it never asked for.
// Must match CONFIG_FILE_ENV in shared/common/typescript/runtime/config.ts and
// shared/common/rust/runtime/src/lib.rs.
const ConfigFileEnv = "WOOFX3_CONFIG"

// RootDirEnv names the config root directory, holding .env and, unless WOOFX3_CONFIG is set,
// .woofx3.json.
const RootDirEnv = "WOOFX3_ROOT"

// configLocation is where configuration is read from.
type configLocation struct {
	// rootDir holds .env, and .woofx3.json unless configPath says otherwise.
	rootDir string
	// configPath is the JSON config file.
	configPath string
	// configRequired is true when configPath was named explicitly, so a missing file is an error.
	configRequired bool
}

// resolveConfigLocation picks the config root and file, first match wins:
//   - options.RootDir: that directory's .env and .woofx3.json.
//   - WOOFX3_CONFIG: that file; .env from WOOFX3_ROOT if set, else the file's directory.
//   - WOOFX3_ROOT: that directory's .env and .woofx3.json.
//   - otherwise the nearest directory at or above the working directory holding a config file.
//
// Paths are made absolute when possible.
func resolveConfigLocation(options *LoadRuntimeEnvOptions) configLocation {
	if options != nil && options.RootDir != "" {
		root := absOrSelf(options.RootDir)
		return configLocation{rootDir: root, configPath: filepath.Join(root, ".woofx3.json")}
	}
	root := ""
	if v := os.Getenv(RootDirEnv); v != "" {
		root = absOrSelf(v)
	}
	if v := os.Getenv(ConfigFileEnv); v != "" {
		configPath := absOrSelf(v)
		if root == "" {
			root = filepath.Dir(configPath)
		}
		return configLocation{rootDir: root, configPath: configPath, configRequired: true}
	}
	if root == "" {
		root = findProjectRoot(".")
	}
	return configLocation{rootDir: root, configPath: filepath.Join(root, ".woofx3.json")}
}

func absOrSelf(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		return abs
	}
	return path
}

// LoadRuntimeEnv resolves configuration from .woofx3.json, .env and the process environment, keyed
// as WOOFX3_* variables. Precedence, highest first: the process environment, then .env, then
// .woofx3.json -- a deployment configures by variables, so a value baked into the file must never
// beat one the host set. A blank value never masks a non-blank one from a lower source; a key blank
// everywhere still resolves, to blank. See resolveConfigLocation for where the files are found.
func LoadRuntimeEnv(options *LoadRuntimeEnvOptions) (map[string]string, error) {
	location := resolveConfigLocation(options)
	rootDir := location.rootDir

	if location.configRequired {
		if _, err := os.Stat(location.configPath); err != nil {
			return nil, fmt.Errorf("%s names a config file that cannot be read: %w", ConfigFileEnv, err)
		}
	}
	woofx3, err := loadWoofx3Config(location.configPath)
	if err != nil {
		return nil, err
	}
	fromFile := make(map[string]string, len(woofx3))
	for key, val := range woofx3 {
		fromFile["WOOFX3_"+camelToScreamingSnake(key)] = valueToString(val)
	}

	fromDotenv, err := parseDotenv(filepath.Join(rootDir, ".env"))
	if err != nil {
		return nil, err
	}

	fromProcess := make(map[string]string)
	for _, e := range os.Environ() {
		idx := strings.Index(e, "=")
		if idx > 0 {
			fromProcess[e[:idx]] = e[idx+1:]
		}
	}

	return mergeByPrecedence(fromFile, fromDotenv, fromProcess), nil
}

// mergeByPrecedence merges sources given lowest precedence first. A later source overrides an
// earlier one unless its value is blank: a "" left in a config file, or an unset variable passed
// through by a compose file, means "not set here".
func mergeByPrecedence(sources ...map[string]string) map[string]string {
	merged := make(map[string]string)
	for _, source := range sources {
		for key, value := range source {
			if _, present := merged[key]; strings.TrimSpace(value) != "" || !present {
				merged[key] = value
			}
		}
	}
	return merged
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
