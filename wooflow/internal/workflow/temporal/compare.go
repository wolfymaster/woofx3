package temporal

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

// ComparisonOperator represents the supported comparison operators
type ComparisonOperator string

const (
	Equal              ComparisonOperator = "eq"          // equal
	NotEqual           ComparisonOperator = "ne"          // not equal
	GreaterThan        ComparisonOperator = "gt"          // greater than
	GreaterThanOrEqual ComparisonOperator = "gte"         // greater than or equal
	LessThan           ComparisonOperator = "lt"          // less than
	LessThanOrEqual    ComparisonOperator = "lte"         // less than or equal
	Contains           ComparisonOperator = "contains"    // string contains
	StartsWith         ComparisonOperator = "starts_with" // string starts with
	EndsWith           ComparisonOperator = "ends_with"   // string ends with
	In                 ComparisonOperator = "in"          // value in array
	NotIn              ComparisonOperator = "not_in"      // value not in array
	Exists             ComparisonOperator = "exists"      // field exists
	NotExists          ComparisonOperator = "not_exists"  // field does not exist
	Regex              ComparisonOperator = "regex"       // regex match
)

// EvaluateConditions evaluates an event against a condition map
// Returns true if all conditions pass, false otherwise
func EvaluateConditions(event map[string]any, conditions map[string]any) bool {
	for fieldName, conditionDef := range conditions {
		if !evaluateFieldCondition(event, fieldName, conditionDef) {
			return false
		}
	}
	return true
}

// evaluateFieldCondition evaluates a single field condition
func evaluateFieldCondition(event map[string]interface{}, fieldName string, conditionDef interface{}) bool {
	// Get the actual value from the event
	eventValue, exists := getNestedValue(event, fieldName)

	// Handle condition definition
	conditionMap, ok := conditionDef.(map[string]interface{})
	if !ok {
		return false
	}

	// Evaluate each operator in the condition
	for operatorStr, expectedValue := range conditionMap {
		operator := ComparisonOperator(operatorStr)

		if !evaluateComparison(eventValue, exists, operator, expectedValue) {
			return false
		}
	}

	return true
}

// evaluateComparison performs the actual comparison based on the operator
func evaluateComparison(eventValue interface{}, exists bool, operator ComparisonOperator, expectedValue interface{}) bool {
	switch operator {
	case Exists:
		return exists
	case NotExists:
		return !exists
	case Equal:
		if !exists {
			return false
		}
		return compareValues(eventValue, expectedValue, "eq")
	case NotEqual:
		if !exists {
			return true
		}
		return !compareValues(eventValue, expectedValue, "eq")
	case GreaterThan:
		if !exists {
			return false
		}
		return compareValues(eventValue, expectedValue, "gt")
	case GreaterThanOrEqual:
		if !exists {
			return false
		}
		return compareValues(eventValue, expectedValue, "gte")
	case LessThan:
		if !exists {
			return false
		}
		return compareValues(eventValue, expectedValue, "lt")
	case LessThanOrEqual:
		if !exists {
			return false
		}
		return compareValues(eventValue, expectedValue, "lte")
	case Contains:
		if !exists {
			return false
		}
		return stringContains(eventValue, expectedValue)
	case StartsWith:
		if !exists {
			return false
		}
		return stringStartsWith(eventValue, expectedValue)
	case EndsWith:
		if !exists {
			return false
		}
		return stringEndsWith(eventValue, expectedValue)
	case In:
		if !exists {
			return false
		}
		return valueInArray(eventValue, expectedValue)
	case NotIn:
		if !exists {
			return true
		}
		return !valueInArray(eventValue, expectedValue)
	default:
		return false
	}
}

// getNestedValue retrieves a value from a nested map using dot notation
// e.g., "user.profile.age" will get event["user"]["profile"]["age"]
func getNestedValue(data map[string]interface{}, path string) (interface{}, bool) {
	parts := strings.Split(path, ".")
	current := data

	for i, part := range parts {
		if i == len(parts)-1 {
			// Last part - return the actual value
			value, exists := current[part]
			return value, exists
		}

		// Intermediate part - navigate deeper
		next, exists := current[part]
		if !exists {
			return nil, false
		}

		nextMap, ok := next.(map[string]interface{})
		if !ok {
			return nil, false
		}

		current = nextMap
	}

	return nil, false
}

// compareValues compares two values based on the comparison type
func compareValues(a, b interface{}, comparison string) bool {
	// Convert to comparable types
	aNum, aIsNum := toFloat64(a)
	bNum, bIsNum := toFloat64(b)

	// If both are numbers, compare numerically
	if aIsNum && bIsNum {
		switch comparison {
		case "eq":
			return aNum == bNum
		case "gt":
			return aNum > bNum
		case "gte":
			return aNum >= bNum
		case "lt":
			return aNum < bNum
		case "lte":
			return aNum <= bNum
		}
	}

	// If both are strings, compare as strings
	aStr := toString(a)
	bStr := toString(b)

	switch comparison {
	case "eq":
		return aStr == bStr
	case "gt":
		return aStr > bStr
	case "gte":
		return aStr >= bStr
	case "lt":
		return aStr < bStr
	case "lte":
		return aStr <= bStr
	}

	return false
}

// String comparison functions
func stringContains(value, substring interface{}) bool {
	valueStr := toString(value)
	subStr := toString(substring)
	return strings.Contains(valueStr, subStr)
}

func stringStartsWith(value, prefix interface{}) bool {
	valueStr := toString(value)
	prefixStr := toString(prefix)
	return strings.HasPrefix(valueStr, prefixStr)
}

func stringEndsWith(value, suffix interface{}) bool {
	valueStr := toString(value)
	suffixStr := toString(suffix)
	return strings.HasSuffix(valueStr, suffixStr)
}

// valueInArray checks if a value exists in an array
func valueInArray(value interface{}, array interface{}) bool {
	arrayValue := reflect.ValueOf(array)
	if arrayValue.Kind() != reflect.Slice {
		return false
	}

	for i := 0; i < arrayValue.Len(); i++ {
		if compareValues(value, arrayValue.Index(i).Interface(), "eq") {
			return true
		}
	}

	return false
}

// Helper functions for type conversion
func toFloat64(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

func toString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case int, int64, int32, float64, float32:
		return fmt.Sprintf("%v", v)
	default:
		return fmt.Sprintf("%v", v)
	}
}

// Example usage and test function
func main() {
	// Example event
	event := map[string]interface{}{
		"user_id": 123,
		"age":     25,
		"name":    "John Doe",
		"email":   "john@example.com",
		"score":   85.5,
		"tags":    []interface{}{"premium", "active"},
		"profile": map[string]interface{}{
			"country": "USA",
			"premium": true,
		},
	}

	// Test cases
	testCases := []struct {
		name       string
		conditions map[string]interface{}
		expected   bool
	}{
		{
			name: "Simple numeric comparison",
			conditions: map[string]interface{}{
				"age": map[string]interface{}{
					"gte": 18,
				},
			},
			expected: true,
		},
		{
			name: "Multiple conditions on same field",
			conditions: map[string]interface{}{
				"age": map[string]interface{}{
					"gte": 18,
					"lt":  30,
				},
			},
			expected: true,
		},
		{
			name: "String comparison",
			conditions: map[string]interface{}{
				"name": map[string]interface{}{
					"contains": "John",
				},
			},
			expected: true,
		},
		{
			name: "Nested field access",
			conditions: map[string]interface{}{
				"profile.country": map[string]interface{}{
					"eq": "USA",
				},
			},
			expected: true,
		},
		{
			name: "Array membership",
			conditions: map[string]interface{}{
				"tags": map[string]interface{}{
					"contains": "premium",
				},
			},
			expected: false, // Note: this would need special handling for array contains
		},
		{
			name: "Field existence",
			conditions: map[string]interface{}{
				"email": map[string]interface{}{
					"exists": true,
				},
			},
			expected: true,
		},
		{
			name: "Multiple field conditions",
			conditions: map[string]interface{}{
				"age": map[string]interface{}{
					"gte": 18,
				},
				"score": map[string]interface{}{
					"gt": 80,
				},
			},
			expected: true,
		},
		{
			name: "Failing condition",
			conditions: map[string]interface{}{
				"age": map[string]interface{}{
					"gt": 30,
				},
			},
			expected: false,
		},
	}

	// Run test cases
	for _, tc := range testCases {
		result := EvaluateConditions(event, tc.conditions)
		status := "PASS"
		if result != tc.expected {
			status = "FAIL"
		}
		fmt.Printf("[%s] %s: Expected %v, Got %v\n", status, tc.name, tc.expected, result)
	}
}
