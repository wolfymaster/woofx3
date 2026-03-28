package nats

import (
	"log/slog"
	"os"
	"reflect"
)

func CreateMessageBus(config Config, logger *slog.Logger) (*Client, error) {
	client := NewClient(config, logger)
	if err := client.Connect(); err != nil {
		return nil, err
	}
	return client, nil
}

func FromConfig(appConfig any) (Config, bool) {
	if appConfig == nil {
		return Config{}, false
	}
	v := reflect.ValueOf(appConfig)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return Config{}, false
	}
	configType := reflect.TypeOf(Config{})
	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		ft := v.Type().Field(i).Type
		if ft == configType {
			return field.Interface().(Config), true
		}
		if ft.Kind() == reflect.Ptr && ft.Elem() == configType {
			if field.IsNil() {
				return Config{}, true
			}
			return field.Elem().Interface().(Config), true
		}
	}
	return Config{}, false
}

func FromEnv(logger *slog.Logger) (*Client, error) {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = "nats://localhost:4222"
	}

	name := os.Getenv("NATS_CLIENT_NAME")
	if name == "" {
		name = "unnamed-client"
	}

	config := Config{
		URL:      url,
		Name:     name,
		JWT:      os.Getenv("NATS_JWT"),
		NKeySeed: os.Getenv("NATS_NKEY_SEED"),
	}

	return CreateMessageBus(config, logger)
}
