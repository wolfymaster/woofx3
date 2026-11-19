package barkloader_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/barkloader"
	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
)

func TestModuleFieldOptionsRequestFixtures(t *testing.T) {
	fixturetest.Run[barkloader.ModuleFieldOptionsRequest](t, "barkloader", "module-field-options-request.json", "ModuleFieldOptionsRequest")
}
