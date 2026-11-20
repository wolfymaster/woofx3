package workflow_test

import (
	"testing"

	"github.com/wolfymaster/woofx3/common/messages/fixturetest"
	"github.com/wolfymaster/woofx3/common/messages/workflow"
)

func TestWorkflowExecuteRequestFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowExecuteRequest](t, "workflow", "workflow-execute-request.json", "WorkflowExecuteRequest")
}

func TestWorkflowExecuteReplyFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowExecuteReply](t, "workflow", "workflow-execute-reply.json", "WorkflowExecuteReply")
}

func TestWorkflowReplayRequestFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowReplayRequest](t, "workflow", "workflow-replay-request.json", "WorkflowReplayRequest")
}

func TestWorkflowCommandExecuteRequestFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowCommandExecuteRequest](t, "workflow", "workflow-command-execute-request.json", "WorkflowCommandExecuteRequest")
}

func TestWorkflowCancelRequestFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowCancelRequest](t, "workflow", "workflow-cancel-request.json", "WorkflowCancelRequest")
}

func TestWorkflowCancelReplyFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowCancelReply](t, "workflow", "workflow-cancel-reply.json", "WorkflowCancelReply")
}

func TestWorkflowRunStartedEventFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowRunStartedEvent](t, "workflow", "workflow-run-started-event.json", "WorkflowRunStartedEvent")
}

func TestWorkflowRunCompletedEventFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowRunCompletedEvent](t, "workflow", "workflow-run-completed-event.json", "WorkflowRunCompletedEvent")
}

func TestWorkflowRunFailedEventFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowRunFailedEvent](t, "workflow", "workflow-run-failed-event.json", "WorkflowRunFailedEvent")
}

func TestWorkflowRunCancelledEventFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowRunCancelledEvent](t, "workflow", "workflow-run-cancelled-event.json", "WorkflowRunCancelledEvent")
}

func TestWorkflowHealthSnapshotEventFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowHealthSnapshotEvent](t, "workflow", "workflow-health-snapshot-event.json", "WorkflowHealthSnapshotEvent")
}

func TestWorkflowHealthChangedEventFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowHealthChangedEvent](t, "workflow", "workflow-health-changed-event.json", "WorkflowHealthChangedEvent")
}

func TestWorkflowHealthReplyFixtures(t *testing.T) {
	fixturetest.Run[workflow.WorkflowHealthReply](t, "workflow", "workflow-health-reply.json", "WorkflowHealthReply")
}
