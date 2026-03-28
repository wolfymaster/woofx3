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

// loadEnvMap pulls in variables from os environment, .env, and .woofx3.json/.woofx3.config
// into a single map. Precedence (lowest to highest): os env, .env, woofx3 config.
// Does not modify the process environment. Returns the map and the config file path used, or "" if none.
func loadEnvMap(confPath string) (map[string]string, string, error) {
	var rootDir, configPath string
	if confPath != "" {
		rootDir = filepath.Dir(confPath)
		configPath = confPath
	} else {
		rootDir = findProjectRoot(".")
		for _, name := range []string{".woofx3.json", ".woofx3.config"} {
			p := filepath.Join(rootDir, name)
			if _, err := os.Stat(p); err == nil {
				configPath = p
				break
			}
		}
	}

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
		return nil, "", err
	}
	for k, v := range dotenv {
		env[k] = v
	}

	if configPath != "" {
		woofx3, err := loadWoofx3JSON(configPath)
		if err != nil {
			return nil, "", err
		}
		for key, val := range woofx3 {
			envKey := "WOOFX3_" + camelToScreamingSnake(key)
			env[envKey] = valueToString(val)
		}
	}

	return env, configPath, nil
}

// LoadConfig loads configuration from env, .env, and optionally .woofx3.json/.woofx3.config.
// If confPath is non-empty, that file is used as the config file; otherwise the project root is searched.
// Does not set process environment; returns a Configuration object with defaults applied and env/file merged.
func LoadConfig(confPath string) (*Configuration, error) {
	env, configPath, err := loadEnvMap(confPath)
	if err != nil {
		return nil, err
	}

	cfg := DefaultConfiguration()
	loadPath := confPath
	if loadPath == "" && configPath != "" {
		loadPath = configPath
	}
	if loadPath != "" {
		if err := cfg.Load(loadPath); err != nil {
			return nil, err
		}
	} else if err := cfg.Load(""); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	cfg.OverlayFromMap(env)
	return cfg, nil
}
