package outbox_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/outbox"
)

func TestDatabaseRecordChangedEventFixtures(t *testing.T) {
	fixturetest.Run[outbox.DatabaseRecordChangedEvent](t, "outbox", "database-record-changed-event.json", "DatabaseRecordChangedEvent")
}

func TestUserPageFormSubmittedEventFixtures(t *testing.T) {
	fixturetest.Run[outbox.UserPageFormSubmittedEvent](t, "outbox", "userpage-form-submitted-event.json", "UserPageFormSubmittedEvent")
}

func TestViewerSegmentEnteredEventFixtures(t *testing.T) {
	fixturetest.Run[outbox.ViewerSegmentEnteredEvent](t, "outbox", "viewer-segment-entered-event.json", "ViewerSegmentEnteredEvent")
}

func TestViewerSegmentLeftEventFixtures(t *testing.T) {
	fixturetest.Run[outbox.ViewerSegmentLeftEvent](t, "outbox", "viewer-segment-left-event.json", "ViewerSegmentLeftEvent")
}
