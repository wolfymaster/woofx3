package services

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

func TestStepToProtoCarriesTheRowsIdentityAndTimestamps(t *testing.T) {
	created := time.Date(2026, 10, 20, 12, 0, 0, 123456789, time.UTC)
	updated := created.Add(2 * time.Second)
	row := models.WorkflowExecutionStep{
		ID:          uuid.New(),
		ExecutionID: uuid.New(),
		TaskID:      "say-hi",
		Status:      "success",
		Attempt:     2,
		StepIndex:   1,
		Inputs:      `{"text":"hi"}`,
		CreatedAt:   created,
		UpdatedAt:   updated,
	}

	step := stepToProto(&row)

	if step.Id != row.ID.String() {
		t.Errorf("id = %q, want %q", step.Id, row.ID.String())
	}
	if !step.CreatedAt.AsTime().Equal(created) || !step.UpdatedAt.AsTime().Equal(updated) {
		t.Errorf("timestamps = %v / %v, want %v / %v", step.CreatedAt.AsTime(), step.UpdatedAt.AsTime(), created, updated)
	}
	if step.StepId != "say-hi" || step.Attempt != 2 || step.InputsJson != `{"text":"hi"}` {
		t.Errorf("step lost its fields: %+v", step)
	}
}
