package triggers

import "github.com/wolfymaster/woofx3/workflow/internal/types"

// NoopRegistrar is a zero-behavior Registrar for tests and bootstrapping.
type NoopRegistrar struct{}

func (NoopRegistrar) Register(string, *types.TriggerConfig) error   { return nil }
func (NoopRegistrar) Unregister(string, *types.TriggerConfig) error { return nil }
