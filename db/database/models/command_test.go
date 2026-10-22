package models

import (
	"strings"
	"testing"
)

func TestParseCommandVisibility(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    CommandVisibility
		wantErr bool
	}{
		{name: "public", value: "public", want: CommandVisibilityPublic},
		{name: "restricted", value: "restricted", want: CommandVisibilityRestricted},
		{name: "empty", value: "", wantErr: true},
		{name: "case variant", value: "Public", wantErr: true},
		{name: "leading whitespace", value: " restricted", wantErr: true},
		{name: "unknown", value: "moderators", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseCommandVisibility(tt.value)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParseCommandVisibility(%q) = %q, want an error", tt.value, got)
				}
				if !strings.Contains(err.Error(), `"public"`) || !strings.Contains(err.Error(), `"restricted"`) {
					t.Errorf("error %q does not name the accepted values", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseCommandVisibility(%q): %v", tt.value, err)
			}
			if got != tt.want {
				t.Errorf("ParseCommandVisibility(%q) = %q, want %q", tt.value, got, tt.want)
			}
		})
	}
}
