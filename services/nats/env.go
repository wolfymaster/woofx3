package main

import (
	"os"
	"path/filepath"

	"github.com/wolfymaster/woofx3/common/config"
)

// resolveConfigLocation picks the config file and .env directory: the -conf flag's file, with .env
// from its directory, else wherever config.ResolveLocation finds them.
func resolveConfigLocation(confPath string) config.Location {
	if confPath == "" {
		return config.ResolveLocation("")
	}
	if abs, err := filepath.Abs(confPath); err == nil {
		confPath = abs
	}
	return config.Location{RootDir: filepath.Dir(confPath), ConfigPath: confPath}
}

// LoadConfig loads configuration from the process environment, .env and the config file, in that
// order of precedence -- the same as every other service, so a deployment's variables beat values
// baked into the image. See resolveConfigLocation for where the files are found. When nothing
// named a location and the search found no config file, the config files next to the executable
// are tried instead. Does not set the process environment.
func LoadConfig(confPath string) (*Configuration, error) {
	location := resolveConfigLocation(confPath)
	env, err := loadEnv(location)
	if err != nil {
		return nil, err
	}

	cfg := DefaultConfiguration()
	if location.ConfigPath != "" {
		if err := cfg.Load(location.ConfigPath); err != nil {
			return nil, err
		}
	} else if location.Searched {
		if err := cfg.Load(""); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	if err := cfg.OverlayFromMap(env); err != nil {
		return nil, err
	}
	return cfg, nil
}

// loadEnv merges the config sources with every message bus key spelt
// canonically (see canonicalKey), so a file key and the variable that
// overrides it meet under one name and precedence holds between them.
func loadEnv(location config.Location) (map[string]string, error) {
	sources, err := config.LoadSources(location)
	if err != nil {
		return nil, err
	}
	merged := make([]map[string]string, 0, 3)
	for _, source := range []map[string]string{sources.File, sources.Dotenv, sources.Process} {
		canonical, err := canonicalSource(source)
		if err != nil {
			return nil, err
		}
		merged = append(merged, canonical)
	}
	return config.MergeByPrecedence(merged...), nil
}
