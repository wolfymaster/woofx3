package config

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Sources are the three places configuration comes from, each keyed as WOOFX3_* variables.
type Sources struct {
	// File holds the config file's keys, converted from camelCase.
	File map[string]string
	// Dotenv holds the .env file in the root directory.
	Dotenv map[string]string
	// Process holds the process environment.
	Process map[string]string
}

// LoadSources reads every source at location. A missing config file or .env is not an error,
// except a config file WOOFX3_CONFIG named. A relative WOOFX3_DATA_DIR is (see CheckDataDir).
func LoadSources(location Location) (Sources, error) {
	if err := CheckDataDir(); err != nil {
		return Sources{}, err
	}
	if location.Required {
		if _, err := os.Stat(location.ConfigPath); err != nil {
			return Sources{}, fmt.Errorf("%s names a config file that cannot be read: %w", ConfigFileEnv, err)
		}
	}
	fromFile := make(map[string]string)
	if location.ConfigPath != "" {
		values, err := ReadFile(location.ConfigPath)
		if err != nil {
			return Sources{}, err
		}
		for key, value := range values {
			fromFile["WOOFX3_"+CamelToScreamingSnake(key)] = valueToString(value)
		}
	}

	fromDotenv, err := parseDotenv(filepath.Join(location.RootDir, ".env"))
	if err != nil {
		return Sources{}, err
	}

	fromProcess := make(map[string]string)
	for _, entry := range os.Environ() {
		if key, value, found := strings.Cut(entry, "="); found && key != "" {
			fromProcess[key] = value
		}
	}

	return Sources{File: fromFile, Dotenv: fromDotenv, Process: fromProcess}, nil
}

// Merge merges the sources by precedence, highest first: the process environment, then .env, then
// the config file -- a deployment configures by variables, so a value baked into the file must
// never beat one the host set.
func (s Sources) Merge() map[string]string {
	return MergeByPrecedence(s.File, s.Dotenv, s.Process)
}

// Load reads and merges every source at location. See LoadSources and Sources.Merge.
func Load(location Location) (map[string]string, error) {
	sources, err := LoadSources(location)
	if err != nil {
		return nil, err
	}
	return sources.Merge(), nil
}

// MergeByPrecedence merges sources given lowest precedence first. A later source overrides an
// earlier one unless its value is blank: a "" left in a config file, or an unset variable passed
// through by a compose file, means "not set here". A key blank everywhere still resolves, to
// blank.
func MergeByPrecedence(sources ...map[string]string) map[string]string {
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

// ReadFile reads a JSON config file. A missing file reads as no config; one that exists but cannot
// be read, does not parse, or does not hold a JSON object is an error, so a typo in a deployment's
// config stops the service instead of starting it on defaults.
func ReadFile(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read config file %s: %w", path, err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("parse config file %s: %w", path, err)
	}
	if out == nil {
		return nil, fmt.Errorf("parse config file %s: the config file must hold a JSON object", path)
	}
	return out, nil
}

// CamelToScreamingSnake maps a config file key to its variable name, without the WOOFX3_ prefix:
// messagebusWebSocketPort becomes MESSAGEBUS_WEB_SOCKET_PORT.
func CamelToScreamingSnake(s string) string {
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

func parseDotenv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", path, err)
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
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return out, nil
}

func valueToString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	default:
		return fmt.Sprint(v)
	}
}
