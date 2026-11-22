package messages_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages"
	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
)

func TestHeartbeatEventFixtures(t *testing.T) {
	fixturetest.Run[messages.HeartbeatEvent](t, "heartbeat", "heartbeat-event.json", "HeartbeatEvent")
}

func TestDatabaseRecordChangedEventFixtures(t *testing.T) {
	fixturetest.Run[messages.DatabaseRecordChangedEvent](t, "outbox", "database-record-changed-event.json", "DatabaseRecordChangedEvent")
}

func TestUserPageFormSubmittedEventFixtures(t *testing.T) {
	fixturetest.Run[messages.UserPageFormSubmittedEvent](t, "outbox", "userpage-form-submitted-event.json", "UserPageFormSubmittedEvent")
}

func TestViewerSegmentEnteredEventFixtures(t *testing.T) {
	fixturetest.Run[messages.ViewerSegmentEnteredEvent](t, "outbox", "viewer-segment-entered-event.json", "ViewerSegmentEnteredEvent")
}

func TestViewerSegmentLeftEventFixtures(t *testing.T) {
	fixturetest.Run[messages.ViewerSegmentLeftEvent](t, "outbox", "viewer-segment-left-event.json", "ViewerSegmentLeftEvent")
}

func TestSceneCommandRequestFixtures(t *testing.T) {
	fixturetest.Run[messages.SceneCommandRequest](t, "scene", "scene-command-request.json", "SceneCommandRequest")
}

func TestSceneCommandReplyFixtures(t *testing.T) {
	fixturetest.Run[messages.SceneCommandReply](t, "scene", "scene-command-reply.json", "SceneCommandReply")
}

func TestWorkflowExecuteRequestFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowExecuteRequest](t, "workflow", "workflow-execute-request.json", "WorkflowExecuteRequest")
}

func TestWorkflowExecuteReplyFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowExecuteReply](t, "workflow", "workflow-execute-reply.json", "WorkflowExecuteReply")
}

func TestWorkflowReplayRequestFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowReplayRequest](t, "workflow", "workflow-replay-request.json", "WorkflowReplayRequest")
}

func TestWorkflowCommandExecuteRequestFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowCommandExecuteRequest](t, "workflow", "workflow-command-execute-request.json", "WorkflowCommandExecuteRequest")
}

func TestWorkflowCancelRequestFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowCancelRequest](t, "workflow", "workflow-cancel-request.json", "WorkflowCancelRequest")
}

func TestWorkflowCancelReplyFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowCancelReply](t, "workflow", "workflow-cancel-reply.json", "WorkflowCancelReply")
}

func TestWorkflowRunStartedEventFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowRunStartedEvent](t, "workflow", "workflow-run-started-event.json", "WorkflowRunStartedEvent")
}

func TestWorkflowRunCompletedEventFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowRunCompletedEvent](t, "workflow", "workflow-run-completed-event.json", "WorkflowRunCompletedEvent")
}

func TestWorkflowRunFailedEventFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowRunFailedEvent](t, "workflow", "workflow-run-failed-event.json", "WorkflowRunFailedEvent")
}

func TestWorkflowRunCancelledEventFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowRunCancelledEvent](t, "workflow", "workflow-run-cancelled-event.json", "WorkflowRunCancelledEvent")
}

func TestWorkflowHealthSnapshotEventFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowHealthSnapshotEvent](t, "workflow", "workflow-health-snapshot-event.json", "WorkflowHealthSnapshotEvent")
}

func TestWorkflowHealthChangedEventFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowHealthChangedEvent](t, "workflow", "workflow-health-changed-event.json", "WorkflowHealthChangedEvent")
}

func TestWorkflowHealthReplyFixtures(t *testing.T) {
	fixturetest.Run[messages.WorkflowHealthReply](t, "workflow", "workflow-health-reply.json", "WorkflowHealthReply")
}
