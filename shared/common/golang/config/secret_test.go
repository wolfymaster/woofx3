package config

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateSecret(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  error
	}{
		{"empty", "", ErrSecretEmpty},
		{"whitespace only", " \t\n", ErrSecretEmpty},
		{"CHANGE_ME", "CHANGE_ME", ErrSecretPlaceholder},
		{"changeme", "changeme", ErrSecretPlaceholder},
		{"change-me", "Change-Me", ErrSecretPlaceholder},
		{"padded placeholder", "  secret  ", ErrSecretPlaceholder},
		{"password", "PASSWORD", ErrSecretPlaceholder},
		{"placeholder", "placeholder", ErrSecretPlaceholder},
		{"todo", "TODO", ErrSecretPlaceholder},
		{"xxx", "xxx", ErrSecretPlaceholder},
		{"test", "test", ErrSecretPlaceholder},
		{"31 bytes", strings.Repeat("a", 31), ErrSecretTooShort},
		{"31 bytes once trimmed", " " + strings.Repeat("a", 31) + " ", ErrSecretTooShort},
		{"32 bytes", strings.Repeat("a", 32), nil},
		{"64 hex", strings.Repeat("0123456789abcdef", 4), nil},
		{"multibyte counts bytes", strings.Repeat("é", 16), nil},
		{"leading byte order mark is kept", "\uFEFF" + strings.Repeat("a", 29), nil},
		{"next line is trimmed", "\u0085" + strings.Repeat("a", 31), ErrSecretTooShort},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateSecret("barkloaderKey", tc.value)
			if tc.want == nil {
				if err != nil {
					t.Fatalf("ValidateSecret = %v, want nil", err)
				}
				return
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("ValidateSecret = %v, want %v", err, tc.want)
			}
			message := err.Error()
			if !strings.Contains(message, "barkloaderKey") || !strings.Contains(message, "WOOFX3_BARKLOADER_KEY") {
				t.Errorf("error %q does not name the key and its variable", message)
			}
			if trimmed := strings.TrimSpace(tc.value); trimmed != "" && strings.Contains(message, trimmed) {
				t.Errorf("error %q echoes the value", message)
			}
		})
	}
}
