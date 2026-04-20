// Package eventmatch implements NATS-style subject matching for routing
// CloudEvents to workflow triggers.
//
// Patterns use the standard NATS wildcard grammar:
//   - `*` matches exactly one token (one segment between dots).
//   - `>` matches one or more remaining tokens (must be the final token).
//
// A pattern with no wildcards reduces to plain string equality, so callers
// can pass either a literal subject or a glob without branching.
package eventmatch

import "strings"

// Matches reports whether `subject` is matched by the NATS-style `pattern`.
//
// Examples:
//
//	Matches("foo.bar", "foo.bar")        // true  (exact)
//	Matches("foo.*", "foo.bar")          // true  (single-token wildcard)
//	Matches("foo.>", "foo.bar.baz")      // true  (multi-token tail)
//	Matches("foo.bar", "foo.baz")        // false
//	Matches("*.user.twitch", "cheer.user.twitch") // true
func Matches(pattern, subject string) bool {
	pp := strings.Split(pattern, ".")
	sp := strings.Split(subject, ".")
	return matchTokens(pp, sp)
}

func matchTokens(pattern, subject []string) bool {
	if len(pattern) == 0 {
		return len(subject) == 0
	}
	// `>` matches one or more remaining tokens — must have at least one.
	if pattern[0] == ">" {
		return len(subject) > 0
	}
	if len(subject) == 0 {
		return false
	}
	if pattern[0] == "*" || pattern[0] == subject[0] {
		return matchTokens(pattern[1:], subject[1:])
	}
	return false
}
