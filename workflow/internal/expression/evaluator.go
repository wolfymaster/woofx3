package expression

import (
	"fmt"
	"regexp"
	"strings"
)

type Condition struct {
	Field    string
	Operator string
	Value    interface{}
}

func Evaluate(condition *Condition, resolver *Resolver) (bool, error) {
	fieldValue, err := resolver.ResolveString(condition.Field)
	if err != nil {
		return false, fmt.Errorf("failed to resolve field: %w", err)
	}

	expectedValue := condition.Value
	if strVal, ok := expectedValue.(string); ok {
		resolved, err := resolver.ResolveString(strVal)
		if err != nil {
			return false, fmt.Errorf("failed to resolve value: %w", err)
		}
		expectedValue = resolved
	}

	return evaluateOperator(condition.Operator, fieldValue, expectedValue)
}

// EvaluateMultiple evaluates multiple conditions with the specified logic ("and" or "or")
// If logic is empty or unrecognized, defaults to "and"
func EvaluateMultiple(conditions []Condition, logic string, resolver *Resolver) (bool, error) {
	if len(conditions) == 0 {
		return true, nil
	}

	useOr := strings.ToLower(logic) == "or"

	for _, cond := range conditions {
		result, err := Evaluate(&cond, resolver)
		if err != nil {
			return false, err
		}

		if useOr {
			// OR logic: return true on first true result
			if result {
				return true, nil
			}
		} else {
			// AND logic: return false on first false result
			if !result {
				return false, nil
			}
		}
	}

	// For AND: all were true; for OR: none were true
	return !useOr, nil
}

func evaluateOperator(op string, actual, expected interface{}) (bool, error) {
	switch op {
	case "eq", "==", "equals":
		return equals(actual, expected), nil
	case "ne", "!=", "not_equals":
		return !equals(actual, expected), nil
	case "gt", ">":
		return compare(actual, expected) > 0, nil
	case "gte", ">=":
		return compare(actual, expected) >= 0, nil
	case "lt", "<":
		return compare(actual, expected) < 0, nil
	case "lte", "<=":
		return compare(actual, expected) <= 0, nil
	case "contains":
		return containsCheck(actual, expected), nil
	case "starts_with":
		return startsWithCheck(actual, expected), nil
	case "ends_with":
		return endsWithCheck(actual, expected), nil
	case "in":
		return inCheck(actual, expected), nil
	case "not_in":
		return !inCheck(actual, expected), nil
	case "exists":
		return actual != nil, nil
	case "not_exists":
		return actual == nil, nil
	case "regex", "matches":
		return regexCheck(actual, expected)
	case "between", "range":
		return betweenCheck(actual, expected)
	default:
		return false, fmt.Errorf("unknown operator: %s", op)
	}
}

func equals(a, b interface{}) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	aNum, aIsNum := toFloat64(a)
	bNum, bIsNum := toFloat64(b)
	if aIsNum && bIsNum {
		return aNum == bNum
	}

	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

func compare(a, b interface{}) int {
	aNum, aIsNum := toFloat64(a)
	bNum, bIsNum := toFloat64(b)

	if aIsNum && bIsNum {
		if aNum < bNum {
			return -1
		} else if aNum > bNum {
			return 1
		}
		return 0
	}

	aStr := fmt.Sprintf("%v", a)
	bStr := fmt.Sprintf("%v", b)
	return strings.Compare(aStr, bStr)
}

func containsCheck(actual, expected interface{}) bool {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)
	return strings.Contains(actualStr, expectedStr)
}

func startsWithCheck(actual, expected interface{}) bool {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)
	return strings.HasPrefix(actualStr, expectedStr)
}

func endsWithCheck(actual, expected interface{}) bool {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)
	return strings.HasSuffix(actualStr, expectedStr)
}

func inCheck(actual, expected interface{}) bool {
	arr, ok := expected.([]interface{})
	if !ok {
		return false
	}

	for _, item := range arr {
		if equals(actual, item) {
			return true
		}
	}
	return false
}

func regexCheck(actual, expected interface{}) (bool, error) {
	pattern := fmt.Sprintf("%v", expected)
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false, fmt.Errorf("invalid regex pattern: %w", err)
	}

	actualStr := fmt.Sprintf("%v", actual)
	return re.MatchString(actualStr), nil
}

func betweenCheck(actual, expected interface{}) (bool, error) {
	bounds, ok := expected.([]interface{})
	if !ok {
		return false, fmt.Errorf("between operator requires [min, max] array, got %T", expected)
	}

	if len(bounds) != 2 {
		return false, fmt.Errorf("between operator requires exactly 2 values [min, max], got %d", len(bounds))
	}

	min, max := bounds[0], bounds[1]

	actualNum, actualIsNum := toFloat64(actual)
	minNum, minIsNum := toFloat64(min)
	maxNum, maxIsNum := toFloat64(max)

	if actualIsNum && minIsNum && maxIsNum {
		return actualNum >= minNum && actualNum <= maxNum, nil
	}

	// Fall back to string comparison for non-numeric types
	actualStr := fmt.Sprintf("%v", actual)
	minStr := fmt.Sprintf("%v", min)
	maxStr := fmt.Sprintf("%v", max)

	return actualStr >= minStr && actualStr <= maxStr, nil
}

func toFloat64(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case int:
		return float64(val), true
	case int32:
		return float64(val), true
	case int64:
		return float64(val), true
	case float32:
		return float64(val), true
	case float64:
		return val, true
	case string:
		return 0, false
	default:
		return 0, false
	}
}
