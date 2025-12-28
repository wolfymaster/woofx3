package expression

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

var expressionPattern = regexp.MustCompile(`\$\{([^}]+)\}`)

type Resolver struct {
	sources map[string]interface{}
}

func NewResolver() *Resolver {
	return &Resolver{
		sources: make(map[string]interface{}),
	}
}

func (r *Resolver) AddSource(name string, data interface{}) {
	r.sources[name] = data
}

func (r *Resolver) Resolve(value interface{}) (interface{}, error) {
	switch v := value.(type) {
	case string:
		return r.ResolveString(v)
	case map[string]interface{}:
		return r.resolveMap(v)
	case []interface{}:
		return r.resolveSlice(v)
	default:
		return value, nil
	}
}

func (r *Resolver) ResolveString(s string) (interface{}, error) {
	if !strings.Contains(s, "${") {
		return s, nil
	}

	if isFullExpression(s) {
		expr := s[2 : len(s)-1]
		return r.evaluateExpression(expr)
	}

	result := expressionPattern.ReplaceAllStringFunc(s, func(match string) string {
		expr := match[2 : len(match)-1]
		resolved, err := r.evaluateExpression(expr)
		if err != nil {
			return match
		}
		return toString(resolved)
	})

	return result, nil
}

func isFullExpression(s string) bool {
	if !strings.HasPrefix(s, "${") || !strings.HasSuffix(s, "}") {
		return false
	}

	depth := 0
	for i, c := range s {
		if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 && i != len(s)-1 {
				return false
			}
		}
	}
	return true
}

func (r *Resolver) evaluateExpression(expr string) (interface{}, error) {
	parts := strings.SplitN(expr, ".", 2)
	if len(parts) == 0 {
		return nil, fmt.Errorf("empty expression")
	}

	source := parts[0]
	var path string
	if len(parts) > 1 {
		path = parts[1]
	}

	if source == "env" {
		if path == "" {
			return nil, fmt.Errorf("env requires a variable name")
		}
		return os.Getenv(path), nil
	}

	data, ok := r.sources[source]
	if !ok {
		return nil, fmt.Errorf("unknown source: %s", source)
	}

	if path == "" {
		return data, nil
	}

	return ResolvePath(data, path)
}

func ResolvePath(data interface{}, path string) (interface{}, error) {
	if path == "" {
		return data, nil
	}

	parts := splitPath(path)
	current := data

	for _, part := range parts {
		if current == nil {
			return nil, fmt.Errorf("cannot access %s on nil", part)
		}

		if idx, isIndex := parseArrayIndex(part); isIndex {
			slice, ok := current.([]interface{})
			if !ok {
				return nil, fmt.Errorf("cannot index non-array with [%d]", idx)
			}
			if idx < 0 || idx >= len(slice) {
				return nil, fmt.Errorf("index out of bounds: %d", idx)
			}
			current = slice[idx]
			continue
		}

		switch v := current.(type) {
		case map[string]interface{}:
			val, ok := v[part]
			if !ok {
				return nil, fmt.Errorf("key not found: %s", part)
			}
			current = val
		default:
			return nil, fmt.Errorf("cannot access %s on %T", part, current)
		}
	}

	return current, nil
}

func splitPath(path string) []string {
	var parts []string
	var current strings.Builder
	inBracket := false

	for _, c := range path {
		switch c {
		case '.':
			if !inBracket && current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			} else if inBracket {
				current.WriteRune(c)
			}
		case '[':
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
			inBracket = true
		case ']':
			if inBracket && current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
			inBracket = false
		default:
			current.WriteRune(c)
		}
	}

	if current.Len() > 0 {
		parts = append(parts, current.String())
	}

	return parts
}

func parseArrayIndex(s string) (int, bool) {
	idx, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return idx, true
}

func (r *Resolver) resolveMap(m map[string]interface{}) (map[string]interface{}, error) {
	result := make(map[string]interface{}, len(m))
	for k, v := range m {
		resolved, err := r.Resolve(v)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve %s: %w", k, err)
		}
		result[k] = resolved
	}
	return result, nil
}

func (r *Resolver) resolveSlice(s []interface{}) ([]interface{}, error) {
	result := make([]interface{}, len(s))
	for i, v := range s {
		resolved, err := r.Resolve(v)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve index %d: %w", i, err)
		}
		result[i] = resolved
	}
	return result, nil
}

func toString(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(val)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", val)
	}
}
