package streamstatus_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/streamstatus"
)

func TestStreamStatusObservedEventFixtures(t *testing.T) {
	fixturetest.Run[streamstatus.StreamStatusObservedEvent](t, "streamstatus", "stream-status-observed-event.json", "StreamStatusObservedEvent")
}

func TestStreamStatusRequestedEventFixtures(t *testing.T) {
	fixturetest.Run[streamstatus.StreamStatusRequestedEvent](t, "streamstatus", "stream-status-requested-event.json", "StreamStatusRequestedEvent")
}
