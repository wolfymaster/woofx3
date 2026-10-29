package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func recordRunAt(t *testing.T, svc client.WorkflowService, workflowID string, startedAt time.Time) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := svc.RecordWorkflowRun(context.Background(), &client.RecordWorkflowRunRequest{
		Id:          id,
		WorkflowId:  workflowID,
		TriggeredBy: "test",
		StartedAt:   timestamppb.New(startedAt),
	}); err != nil {
		t.Fatalf("RecordWorkflowRun: %v", err)
	}
	return id
}

func listExecutionIDs(t *testing.T, svc client.WorkflowService, workflowID string, pageSize int32) []string {
	t.Helper()
	resp, err := svc.ListWorkflowExecutions(context.Background(), &client.ListWorkflowExecutionsRequest{
		WorkflowId: workflowID,
		Page:       1,
		PageSize:   pageSize,
	})
	if err != nil {
		t.Fatalf("ListWorkflowExecutions: %v", err)
	}
	ids := make([]string, len(resp.Executions))
	for i, exec := range resp.Executions {
		ids[i] = exec.Id
	}
	return ids
}

func TestListWorkflowExecutions(t *testing.T) {
	base := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	raid := uuid.New().String()
	follow := uuid.New().String()

	svc, _ := newRunStatusSvc(t)
	// Recorded out of start order, so a list ordered by insertion would differ.
	raidMiddle := recordRunAt(t, svc, raid, base.Add(2*time.Minute))
	raidOldest := recordRunAt(t, svc, raid, base)
	followNewest := recordRunAt(t, svc, follow, base.Add(3*time.Minute))
	raidNewest := recordRunAt(t, svc, raid, base.Add(4*time.Minute))

	tests := []struct {
		name       string
		workflowID string
		pageSize   int32
		want       []string
	}{
		{"every workflow newest first by start", "", 10, []string{raidNewest, followNewest, raidMiddle, raidOldest}},
		{"one workflow's runs only", raid, 10, []string{raidNewest, raidMiddle, raidOldest}},
		{"at most pageSize", raid, 2, []string{raidNewest, raidMiddle}},
		{"a workflow with no runs", uuid.New().String(), 10, []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := listExecutionIDs(t, svc, tc.workflowID, tc.pageSize)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

func TestListWorkflowExecutions_RefusesMalformedWorkflowID(t *testing.T) {
	svc, _ := newRunStatusSvc(t)

	_, err := svc.ListWorkflowExecutions(context.Background(), &client.ListWorkflowExecutionsRequest{
		WorkflowId: "follow-workflow",
		PageSize:   10,
	})

	var twerr twirp.Error
	if !errors.As(err, &twerr) || twerr.Code() != twirp.InvalidArgument {
		t.Fatalf("got %v, want an invalid_argument error", err)
	}
}
