package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wolfymaster/woofx3/db/app/workers"
)

type Config struct {
	DatabaseURL string         `json:"databaseUrl"`
	BadgerPath  string         `json:"badgerPath"`
	NATSURL     string         `json:"natsUrl"`
	HTTPPort    string         `json:"httpPort"`
	Workers     workers.Config `json:"workers"`
}

func LoadConfiguration() (*Config, error) {
	config := &Config{
		BadgerPath: "badger",
		HTTPPort:   "8080",
		Workers:    workers.DefaultConfig(),
	}

	configFile := "conf.json"
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		configFile = filepath.Join("..", "conf.json")
		if _, err := os.Stat(configFile); os.IsNotExist(err) {
			configFile = ""
		}
	}

	if configFile != "" {
		data, err := os.ReadFile(configFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file %s: %w", configFile, err)
		}

		if err := json.Unmarshal(data, config); err != nil {
			return nil, fmt.Errorf("failed to parse config file %s: %w", configFile, err)
		}
	}

	if envVal := os.Getenv("DATABASE_URL"); envVal != "" {
		config.DatabaseURL = envVal
	}
	if envVal := os.Getenv("BADGER_PATH"); envVal != "" {
		config.BadgerPath = envVal
	}
	if envVal := os.Getenv("NATS_URL"); envVal != "" {
		config.NATSURL = envVal
	}
	if envVal := os.Getenv("DATABASE_PROXY_PORT"); envVal != "" {
		config.HTTPPort = envVal
	}

	return config, nil
}

func GetCasbinModelString() (string, error) {
	return `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[role_definition]
g = _, _, _
g2 = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = (hasRole(r.sub, r.obj, p.sub) && hasObjType(r.obj, p.obj) && r.act == p.act) || (keyMatch2(r.sub, p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act)
`, nil
}
