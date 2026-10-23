package main

import (
	"testing"
)

func TestResolveService(t *testing.T) {
	serviceFactoriesMu.Lock()
	saved := serviceFactories
	serviceFactories = map[string]any{
		"text": ServiceFactory[string](func() string { return "hello" }),
	}
	serviceFactoriesMu.Unlock()
	t.Cleanup(func() {
		serviceFactoriesMu.Lock()
		serviceFactories = saved
		serviceFactoriesMu.Unlock()
	})

	t.Run("registered service resolves", func(t *testing.T) {
		got, err := resolveService[string]("text")
		if err != nil || got != "hello" {
			t.Fatalf("got (%q, %v), want (hello, nil)", got, err)
		}
	})

	t.Run("missing key is an error", func(t *testing.T) {
		if _, err := resolveService[string]("absent"); err == nil {
			t.Fatal("expected an error for a missing key")
		}
	})

	t.Run("wrong type is an error", func(t *testing.T) {
		if _, err := resolveService[int]("text"); err == nil {
			t.Fatal("expected an error for a mismatched type")
		}
	})
}
