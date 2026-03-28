package runtime

import (
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

// envTag is the struct tag key used to map fields to env keys and options.
// Format: env:"KEY" or env:"KEY,required" or env:"KEY,default=value".
// KEY is the SCREAMING_SNAKE_CASE name used in the env map. If KEY is empty,
// the field name is converted from camelCase to SCREAMING_SNAKE_CASE.
const envTagKey = "env"

// FillEnvConfig populates dest (a pointer to a struct) from the env map using struct tags.
// Tag format: env:"KEY" or env:"KEY,required" or env:"KEY,default=value".
// Supported field types: string, int, int64, bool.
// Returns an error if a required field is missing or conversion fails.
func FillEnvConfig(env map[string]string, dest interface{}) error {
	if dest == nil {
		return errors.New("FillEnvConfig: dest is nil")
	}
	v := reflect.ValueOf(dest)
	if v.Kind() != reflect.Ptr {
		return errors.New("FillEnvConfig: dest must be a pointer to struct")
	}
	v = v.Elem()
	if v.Kind() != reflect.Struct {
		return errors.New("FillEnvConfig: dest must be a pointer to struct")
	}
	return fillStruct(env, v)
}

func fillStruct(env map[string]string, v reflect.Value) error {
	if v.Kind() != reflect.Struct {
		return nil
	}
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		if !field.CanSet() {
			continue
		}
		sf := t.Field(i)
		switch field.Kind() {
		case reflect.Struct:
			if err := fillStruct(env, field); err != nil {
				return fmt.Errorf("field %s: %w", sf.Name, err)
			}
			continue
		case reflect.Ptr:
			if field.Type().Elem().Kind() == reflect.Struct {
				if field.IsNil() {
					field.Set(reflect.New(field.Type().Elem()))
				}
				if err := fillStruct(env, field.Elem()); err != nil {
					return fmt.Errorf("field %s: %w", sf.Name, err)
				}
				continue
			}
		}
		key, required, def, err := parseEnvTag(sf)
		if err != nil {
			return fmt.Errorf("field %s: %w", sf.Name, err)
		}
		if key == "" {
			continue
		}
		val := env[key]
		if val == "" && def != "" {
			val = def
		}
		if val == "" {
			if required {
				return fmt.Errorf("missing required env: %s", key)
			}
			continue
		}
		if err := setField(field, val); err != nil {
			return fmt.Errorf("field %s (%s): %w", sf.Name, key, err)
		}
	}
	return nil
}

func parseEnvTag(sf reflect.StructField) (key string, required bool, def string, err error) {
	tag := sf.Tag.Get(envTagKey)
	if tag == "" || tag == "-" {
		key = camelToScreamingSnake(sf.Name)
		return key, false, "", nil
	}
	parts := strings.Split(tag, ",")
	key = strings.TrimSpace(parts[0])
	for _, p := range parts[1:] {
		p = strings.TrimSpace(p)
		if p == "required" {
			required = true
		} else if strings.HasPrefix(p, "default=") {
			def = strings.TrimSpace(strings.TrimPrefix(p, "default="))
		}
	}
	return key, required, def, nil
}

func setField(field reflect.Value, val string) error {
	switch field.Kind() {
	case reflect.String:
		field.SetString(val)
		return nil
	case reflect.Int, reflect.Int32, reflect.Int64:
		n, err := strconv.ParseInt(val, 10, 64)
		if err != nil {
			return err
		}
		field.SetInt(n)
		return nil
	case reflect.Bool:
		b, err := parseBool(val)
		if err != nil {
			return err
		}
		field.SetBool(b)
		return nil
	default:
		return fmt.Errorf("unsupported type %s", field.Kind())
	}
}

func parseBool(s string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("invalid bool: %q", s)
	}
}
