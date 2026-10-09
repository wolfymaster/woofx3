package expression

import (
	"fmt"
	"regexp"
	"strings"
)

type Condition struct {
	Field    string
	Operator string
	Value    any
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

	return EvaluateOperator(condition.Operator, fieldValue, expectedValue)
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

// conditionOperators maps every accepted spelling of an operator to its
// canonical name, so callers comparing operators (two filters sharing one
// evaluation, a rule that depends on what an operator does with a missing
// value) compare one name rather than every alias.
var conditionOperators = map[string]string{
	"eq":          "eq",
	"==":          "eq",
	"equals":      "eq",
	"ne":          "ne",
	"!=":          "ne",
	"not_equals":  "ne",
	"gt":          "gt",
	">":           "gt",
	"gte":         "gte",
	">=":          "gte",
	"lt":          "lt",
	"<":           "lt",
	"lte":         "lte",
	"<=":          "lte",
	"contains":    "contains",
	"starts_with": "starts_with",
	"ends_with":   "ends_with",
	"in":          "in",
	"not_in":      "not_in",
	"exists":      "exists",
	"not_exists":  "not_exists",
	"regex":       "regex",
	"matches":     "regex",
	"between":     "between",
	"range":       "between",
}

// CanonicalOperator returns the canonical name of an operator spelling, and
// false when the spelling is not an operator.
func CanonicalOperator(op string) (string, bool) {
	canonical, ok := conditionOperators[op]
	return canonical, ok
}

// EvaluateOperator applies a condition operator to an actual and an expected
// value. Both are taken as they are: nothing is resolved from a template.
func EvaluateOperator(op string, actual, expected any) (bool, error) {
	canonical, ok := CanonicalOperator(op)
	if !ok {
		return false, fmt.Errorf("unknown operator: %s", op)
	}
	switch canonical {
	case "eq":
		return equals(actual, expected), nil
	case "ne":
		return !equals(actual, expected), nil
	case "gt":
		return compare(actual, expected) > 0, nil
	case "gte":
		return compare(actual, expected) >= 0, nil
	case "lt":
		return compare(actual, expected) < 0, nil
	case "lte":
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
	case "regex":
		return regexCheck(actual, expected)
	case "between":
		return betweenCheck(actual, expected)
	default:
		panic(fmt.Sprintf("operator %q has a canonical name %q with no evaluation", op, canonical))
	}
}

func equals(a, b any) bool {
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

func compare(a, b any) int {
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

func containsCheck(actual, expected any) bool {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)
	return strings.Contains(actualStr, expectedStr)
}

func startsWithCheck(actual, expected any) bool {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)
	return strings.HasPrefix(actualStr, expectedStr)
}

func endsWithCheck(actual, expected any) bool {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)
	return strings.HasSuffix(actualStr, expectedStr)
}

func inCheck(actual, expected any) bool {
	arr, ok := expected.([]any)
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

func regexCheck(actual, expected any) (bool, error) {
	pattern := fmt.Sprintf("%v", expected)
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false, fmt.Errorf("invalid regex pattern: %w", err)
	}

	actualStr := fmt.Sprintf("%v", actual)
	return re.MatchString(actualStr), nil
}

func betweenCheck(actual, expected any) (bool, error) {
	bounds, ok := expected.([]any)
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

func toFloat64(v any) (float64, bool) {
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
