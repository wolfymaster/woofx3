package logging

import (
	"fmt"
	"log/slog"
	"runtime"
	"strings"
)

func valueToAny(value slog.Value) any {
	switch value.Kind() {
	case slog.KindBool:
		return value.Bool()
	case slog.KindDuration:
		return value.Duration().String()
	case slog.KindFloat64:
		return value.Float64()
	case slog.KindInt64:
		return value.Int64()
	case slog.KindString:
		return value.String()
	case slog.KindTime:
		return value.Time().UTC().Format(timeRFC3339Nano)
	case slog.KindUint64:
		return value.Uint64()
	case slog.KindGroup:
		group := map[string]any{}
		for _, attr := range value.Group() {
			group[attr.Key] = valueToAny(attr.Value)
		}
		return group
	case slog.KindAny:
		return value.Any()
	default:
		return value.String()
	}
}

const timeRFC3339Nano = "2006-01-02T15:04:05.999999999Z07:00"

func redactAny(value any, redactKeys map[string]struct{}) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, nested := range typed {
			if _, shouldRedact := redactKeys[normalizeKey(key)]; shouldRedact {
				out[key] = "[REDACTED]"
				continue
			}
			out[key] = redactAny(nested, redactKeys)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = redactAny(item, redactKeys)
		}
		return out
	case []string:
		out := make([]string, len(typed))
		copy(out, typed)
		return out
	case string:
		return typed
	default:
		return typed
	}
}

func runtimeCallersFrames(pcs []uintptr) []string {
	frames := runtime.CallersFrames(pcs)
	out := []string{}
	for {
		frame, more := frames.Next()
		function := frame.Function
		if function == "" {
			function = "unknown"
		}
		out = append(out, fmt.Sprintf("%s:%d (%s)", frame.File, frame.Line, strings.TrimSpace(function)))
		if !more {
			break
		}
	}
	return out
}
