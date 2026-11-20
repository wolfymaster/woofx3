package module_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/module"
)

func TestModuleStorageChangedEventFixtures(t *testing.T) {
	fixturetest.Run[module.ModuleStorageChangedEvent](t, "module", "module-storage-changed-event.json", "ModuleStorageChangedEvent")
}
