// Package conditions names the operators a condition may use and the
// expected values each one accepts. The workflow service evaluates
// conditions; the db service checks the ones it stores, such as a fact's
// where tree, so a condition the workflow service would refuse is refused
// when it is saved rather than skipped when it is loaded.
package conditions

import (
	"fmt"
	"regexp"
	"sort"
)

// operators maps every accepted spelling of an operator to its canonical
// name, so callers comparing operators compare one name rather than every
// alias.
var operators = map[string]string{
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

// Canonical returns the canonical name of an operator spelling, and false
// when the spelling is not an operator.
func Canonical(op string) (string, bool) {
	canonical, ok := operators[op]
	return canonical, ok
}

// Spellings returns every accepted operator spelling, sorted, so an evaluator
// can prove it implements each one.
func Spellings() []string {
	spellings := make([]string, 0, len(operators))
	for spelling := range operators {
		spellings = append(spellings, spelling)
	}
	sort.Strings(spellings)
	return spellings
}

// ValidateExpected reports why expected cannot be the value of a condition
// using the canonical operator: a regex needs a pattern that compiles, in and
// not_in a list, between a [min, max] pair. expected is a decoded JSON value.
func ValidateExpected(canonical string, expected any) error {
	switch canonical {
	case "regex":
		pattern, ok := expected.(string)
		if !ok {
			return fmt.Errorf("regex needs a string pattern, got %T", expected)
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return fmt.Errorf("invalid regex pattern: %w", err)
		}
	case "in", "not_in":
		if _, ok := expected.([]any); !ok {
			return fmt.Errorf("%s needs a list value, got %T", canonical, expected)
		}
	case "between":
		bounds, ok := expected.([]any)
		if !ok || len(bounds) != 2 {
			return fmt.Errorf("between needs a [min, max] value")
		}
	}
	return nil
}
