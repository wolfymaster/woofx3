package secrets

import (
	"strings"
	"testing"
)

func TestNewSettingSealRefusesBadWiring(t *testing.T) {
	box := newTestBox(t, 7)
	cases := []struct {
		name string
		box  *Box
		keys []string
		want string
	}{
		{name: "no box", box: nil, keys: []string{"twitch_token"}, want: "secrets box"},
		{name: "empty key", box: box, keys: []string{""}, want: "empty"},
		{name: "duplicate key", box: box, keys: []string{"twitch_token", "twitch_token"}, want: "listed twice"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewSettingSeal(tc.box, tc.keys)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one containing %q", err, tc.want)
			}
		})
	}
}

func TestSettingSealSealsOnlyTheKeysItNames(t *testing.T) {
	seal, err := NewSettingSeal(newTestBox(t, 7), []string{"twitch_token", "other_token"})
	if err != nil {
		t.Fatalf("NewSettingSeal: %v", err)
	}
	cases := []struct {
		name       string
		key        string
		value      string
		wantSealed bool
	}{
		{name: "sealed key", key: "twitch_token", value: `{"refreshToken":"r1"}`, wantSealed: true},
		{name: "sealed key left empty reads as unset", key: "twitch_token", value: "", wantSealed: false},
		{name: "other key", key: "storage.provider", value: "r2", wantSealed: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stored, err := seal.StoredValue(tc.key, tc.value)
			if err != nil {
				t.Fatalf("StoredValue: %v", err)
			}
			if IsSealed(stored) != tc.wantSealed {
				t.Fatalf("stored = %q, sealed want %v", stored, tc.wantSealed)
			}
			if tc.wantSealed && strings.Contains(stored, "r1") {
				t.Fatalf("stored value carries the plain text: %q", stored)
			}
			plain, err := seal.PlainValue(tc.key, stored)
			if err != nil || plain != tc.value {
				t.Fatalf("PlainValue = %q, %v; want %q", plain, err, tc.value)
			}
		})
	}
}

func TestSettingSealRefusesValuesThatDoNotOpenForTheRow(t *testing.T) {
	seal, err := NewSettingSeal(newTestBox(t, 7), []string{"twitch_token", "other_token"})
	if err != nil {
		t.Fatalf("NewSettingSeal: %v", err)
	}
	otherRow, err := seal.StoredValue("other_token", "value")
	if err != nil {
		t.Fatalf("StoredValue: %v", err)
	}
	otherKey, err := NewSettingSeal(newTestBox(t, 9), []string{"twitch_token"})
	if err != nil {
		t.Fatalf("NewSettingSeal: %v", err)
	}
	underOtherKey, err := otherKey.StoredValue("twitch_token", "value")
	if err != nil {
		t.Fatalf("StoredValue: %v", err)
	}
	cases := []struct {
		name   string
		stored string
	}{
		{name: "plain text", stored: `{"refreshToken":"r1"}`},
		{name: "sealed for another row", stored: otherRow},
		{name: "sealed under another key", stored: underOtherKey},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plain, err := seal.PlainValue("twitch_token", tc.stored)
			if err == nil {
				t.Fatalf("PlainValue = %q, want an error", plain)
			}
			if strings.Contains(err.Error(), "r1") {
				t.Fatalf("error carries the stored value: %v", err)
			}
		})
	}
}
