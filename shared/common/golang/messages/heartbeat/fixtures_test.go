package heartbeat_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/heartbeat"
)

func TestHeartbeatEventFixtures(t *testing.T) {
	fixturetest.Run[heartbeat.HeartbeatEvent](t, "heartbeat", "heartbeat-event.json", "HeartbeatEvent")
}
