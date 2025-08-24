package activities

import (
	"fmt"
	"strings"
)

func processPlaceholders(data interface{}, substitutions map[string]interface{}) interface{} {
	if data == nil {
		return nil
	}

	switch v := data.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{})
		for key, value := range v {
			processedValue := processPlaceholders(value, substitutions)

			// Perform placeholder substitution if key is "text" or "value" and value is a string
			if key == "text" || key == "value" {
				if str, ok := processedValue.(string); ok {
					for subKey, subValue := range substitutions {
						placeholder := "{" + subKey + "}"
						str = strings.ReplaceAll(str, placeholder, fmt.Sprintf("%v", subValue))
					}
					processedValue = str
				}
			}

			result[key] = processedValue
		}
		return result

	case []interface{}:
		result := make([]interface{}, len(v))
		for i, item := range v {
			result[i] = processPlaceholders(item, substitutions)
		}
		return result

	default:
		return v
	}
}
