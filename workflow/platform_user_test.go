package main

import (
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestUserInfoPlatform(t *testing.T) {
	tests := []struct {
		name    string
		params  map[string]any
		trigger *types.Event
		want    string
		wantErr string
	}{
		{"origin from trigger", nil, &types.Event{Platform: "twitch"}, "twitch", ""},
		{"explicit origin", map[string]any{"platform": "origin"}, &types.Event{Platform: "twitch"}, "twitch", ""},
		{"explicit platform, no trigger", map[string]any{"platform": "twitch"}, nil, "twitch", ""},
		{"no platform behind the trigger", nil, &types.Event{}, "", "no platform"},
		{"unknown platform", map[string]any{"platform": "kick"}, nil, "", `"kick" is not one`},
		{"not text", map[string]any{"platform": 3.0}, nil, "", "platform must be text"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := userInfoPlatform(tt.params, tt.trigger)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want one containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil || string(got) != tt.want {
				t.Fatalf("got %q, %v; want %q", got, err, tt.want)
			}
			if _, err := userInfoFunction(got); err != nil {
				t.Errorf("every valid platform needs a provider: %v", err)
			}
		})
	}
}

func TestValidatePlatformUserInfoParams(t *testing.T) {
	tests := []struct {
		name    string
		params  map[string]any
		wantErr string
	}{
		{"user only", map[string]any{"user": "wolfy"}, ""},
		{"user expression", map[string]any{"user": "${trigger.data.fromBroadcasterUserName}"}, ""},
		{"platform expression", map[string]any{"user": "x", "platform": "${trigger.platform}"}, ""},
		{"missing user", map[string]any{}, "user parameter is required"},
		{"blank user", map[string]any{"user": "  "}, "user parameter is required"},
		{"all platforms", map[string]any{"user": "x", "platform": "all"}, "a lookup answers for one platform"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePlatformUserInfoParams(tt.params)
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("error = %v, want one containing %q", err, tt.wantErr)
			}
		})
	}
}
