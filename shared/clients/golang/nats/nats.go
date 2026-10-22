package nats

import (
	"log/slog"
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
