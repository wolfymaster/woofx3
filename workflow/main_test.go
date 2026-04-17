package main

import (
	"strings"
	"testing"
)

func TestWorkflowLogDirectoryFromEnv(t *testing.T) {
	tests := []struct {
		name     string
		env      map[string]string
		expected string
	}{
		{
			name: "uses root path from env",
			env: map[string]string{
				"WOOFX3_ROOT_PATH": "/tmp/woofx3",
			},
			expected: "/tmp/woofx3",
		},
		{
			name: "trims root path whitespace",
			env: map[string]string{
				"WOOFX3_ROOT_PATH": "  /tmp/woofx3  ",
			},
			expected: "/tmp/woofx3",
		},
		{
			name:     "returns empty when root path missing",
			env:      map[string]string{},
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := strings.TrimSpace(tc.env["WOOFX3_ROOT_PATH"])
			if got != tc.expected {
				t.Fatalf("expected %q, got %q", tc.expected, got)
			}
		})
	}
}
