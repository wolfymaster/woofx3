package session_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/session"
)

func TestSessionStartedEventFixtures(t *testing.T) {
	fixturetest.Run[session.SessionStartedEvent](t, "session", "session-started-event.json", "SessionStartedEvent")
}

func TestSessionEndedEventFixtures(t *testing.T) {
	fixturetest.Run[session.SessionEndedEvent](t, "session", "session-ended-event.json", "SessionEndedEvent")
}
