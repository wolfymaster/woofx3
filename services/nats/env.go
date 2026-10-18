package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

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
		for _, name := range []string{".woofx3.json"} {
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

func loadWoofx3JSON(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out map[string]interface{}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
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

// configFileEnv and rootDirEnv must match ConfigFileEnv and RootDirEnv in
// shared/common/golang/runtime/env.go.
const (
	configFileEnv = "WOOFX3_CONFIG"
	rootDirEnv    = "WOOFX3_ROOT"
)

// configLocation is where the config file and .env are read from.
type configLocation struct {
	// rootDir holds .env.
	rootDir string
	// configPath is the config file, or "" when there is none.
	configPath string
	// final is true when the location was named by WOOFX3_CONFIG or WOOFX3_ROOT, so a missing
	// config file means "configured by variables only" rather than "look next to the executable".
	final bool
}

// resolveConfigLocation picks the config file and .env directory, first match wins:
//   - confPath (the -conf flag): that file, .env from its directory.
//   - WOOFX3_CONFIG: that file, which must exist; .env from WOOFX3_ROOT if set, else the file's
//     directory.
//   - WOOFX3_ROOT: .woofx3.json or .woofx3.config in that directory, if either exists.
//   - otherwise the project root found above the working directory, falling back in LoadConfig to
//     the candidates next to the executable.
func resolveConfigLocation(confPath string) (configLocation, error) {
	if confPath != "" {
		return configLocation{rootDir: filepath.Dir(confPath), configPath: confPath}, nil
	}
	rootDir := os.Getenv(rootDirEnv)
	if file := os.Getenv(configFileEnv); file != "" {
		if _, err := os.Stat(file); err != nil {
			return configLocation{}, fmt.Errorf("%s names a config file that cannot be read: %w", configFileEnv, err)
		}
		if rootDir == "" {
			rootDir = filepath.Dir(file)
		}
		return configLocation{rootDir: rootDir, configPath: file, final: true}, nil
	}
	if rootDir != "" {
		return configLocation{rootDir: rootDir, configPath: configFileIn(rootDir), final: true}, nil
	}
	rootDir = findProjectRoot(".")
	return configLocation{rootDir: rootDir, configPath: configFileIn(rootDir)}, nil
}

// configFileIn returns the config file in dir, preferring .woofx3.json, or "" if there is none.
func configFileIn(dir string) string {
	for _, name := range []string{".woofx3.json", ".woofx3.config"} {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// loadEnvMap pulls in variables from the config file, .env and the process environment into a
// single map. Precedence, highest first: the process environment, then .env, then the config
// file -- the same order as the shared Go runtime loader, so a deployment's variables beat values
// baked into the image. A blank value never masks a non-blank one from a lower source. Does not
// modify the process environment.
func loadEnvMap(location configLocation) (map[string]string, error) {
	fromFile := make(map[string]string)
	if location.configPath != "" {
		woofx3, err := loadWoofx3JSON(location.configPath)
		if err != nil {
			return nil, err
		}
		for key, val := range woofx3 {
			fromFile["WOOFX3_"+camelToScreamingSnake(key)] = valueToString(val)
		}
	}

	fromDotenv, err := parseDotenv(filepath.Join(location.rootDir, ".env"))
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
// earlier one unless its value is blank. Must match mergeByPrecedence in
// shared/common/golang/runtime/env.go.
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

// LoadConfig loads configuration from env, .env, and optionally .woofx3.json/.woofx3.config.
// See resolveConfigLocation for where the files are found. Does not set process environment;
// returns a Configuration object with defaults applied and env/file merged.
func LoadConfig(confPath string) (*Configuration, error) {
	location, err := resolveConfigLocation(confPath)
	if err != nil {
		return nil, err
	}
	env, err := loadEnvMap(location)
	if err != nil {
		return nil, err
	}

	cfg := DefaultConfiguration()
	if location.configPath != "" {
		if err := cfg.Load(location.configPath); err != nil {
			return nil, err
		}
	} else if !location.final {
		if err := cfg.Load(""); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	if err := cfg.OverlayFromMap(env); err != nil {
		return nil, err
	}
	return cfg, nil
}
