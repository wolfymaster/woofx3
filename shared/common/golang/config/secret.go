package config

import (
	"errors"
	"fmt"
	"strings"
)

// MinSecretBytes is the shortest secret accepted, in bytes: the 256 bits an
// HMAC-SHA256 key needs. Must match MIN_SECRET_BYTES in
// shared/common/typescript/runtime/secret.ts and
// shared/common/rust/runtime/src/secret.rs.
const MinSecretBytes = 32

// placeholderSecrets are values templates and examples have shipped in place
// of a secret, compared case-insensitively. Each is public, so a service
// keyed with one is keyed with a value anyone can read. Must match
// PLACEHOLDER_SECRETS in secret.ts and secret.rs.
var placeholderSecrets = []string{
	"change_me", "changeme", "change-me", "secret", "password", "placeholder", "todo", "xxx", "test",
}

// The ways ValidateSecret refuses a value, for errors.Is.
var (
	ErrSecretEmpty       = errors.New("is not set")
	ErrSecretPlaceholder = errors.New("is a well-known example value")
	ErrSecretTooShort    = fmt.Errorf("is shorter than %d bytes", MinSecretBytes)
)

// ValidateSecret checks the secret held by the config key name (for example
// barkloaderKey). The value is trimmed, then refused when it is empty, a known
// placeholder, or shorter than MinSecretBytes. The error names the key and
// its WOOFX3_* variable and never includes the value.
func ValidateSecret(name, value string) error {
	trimmed := strings.TrimSpace(value)
	var problem error
	switch {
	case trimmed == "":
		problem = ErrSecretEmpty
	case isPlaceholderSecret(trimmed):
		problem = ErrSecretPlaceholder
	case len(trimmed) < MinSecretBytes:
		problem = ErrSecretTooShort
	default:
		return nil
	}
	return fmt.Errorf("%s (WOOFX3_%s) %w: set it to a random value of at least %d bytes",
		name, CamelToScreamingSnake(name), problem, MinSecretBytes)
}

func isPlaceholderSecret(value string) bool {
	for _, placeholder := range placeholderSecrets {
		if strings.EqualFold(value, placeholder) {
			return true
		}
	}
	return false
}
