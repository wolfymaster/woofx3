package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	refsvc "github.com/wolfymaster/woofx3/db/app/services/resource_reference"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type workflowService struct {
	workflowRepo  *repo.WorkflowRepository
	executionRepo *gorm.DB // We'll use direct DB access for executions for now
	publisher     *workers.EventPublisher
	refRepo       *repo.ResourceReferenceRepository
}

func NewWorkflowService(
	workflowRepo *repo.WorkflowRepository,
	db interface{},
	publisher *workers.EventPublisher,
	refRepo *repo.ResourceReferenceRepository,
) client.WorkflowService {
	var dbConn *gorm.DB
	if gormDB, ok := db.(*gorm.DB); ok {
		dbConn = gormDB
	}

	return &workflowService{
		workflowRepo:  workflowRepo,
		executionRepo: dbConn,
		publisher:     publisher,
		refRepo:       refRepo,
	}
}

// syncWorkflowEdges recomputes the resource_references edges for a workflow.
// Failures are logged but do not fail the parent request — edge tracking is a
// secondary index, and the source row has already been written successfully.
func (s *workflowService) syncWorkflowEdges(
	wf *models.WorkflowDefinition,
	createdByType, createdByRef string,
) {
	if s.refRepo == nil {
		return
	}
	appID := wf.ApplicationID
	src := refsvc.WorkflowSource{
		ID:                  wf.ID,
		Name:                wf.Name,
		ApplicationID:       &appID,
		SourceCreatedByType: createdByType,
		SourceCreatedByRef:  createdByRef,
	}
	edges := refsvc.ExtractWorkflowEdges(src, wf.Steps, wf.Trigger)
	if err := s.refRepo.ReplaceEdgesForSource("workflow", wf.ID, edges); err != nil {
		log.Printf("workflow_service: ReplaceEdgesForSource failed for workflow %s: %v", wf.ID, err)
	}
}

func (s *workflowService) CreateWorkflow(ctx context.Context, req *client.CreateWorkflowRequest) (*client.WorkflowResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.workflowRepo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}

	// `steps_json` and `trigger_json` are the canonical workflow
	// definition. The typed `WorkflowStep` proto array was removed
	// in favor of these JSON columns, which the engine reads directly.
	stepsJSON := req.StepsJson
	if stepsJSON == "" {
		stepsJSON = "[]"
	}
	triggerJSON := req.TriggerJson
	if triggerJSON == "" {
		triggerJSON = "{}"
	}

	createdByType := req.CreatedByType
	if createdByType == "" {
		createdByType = "USER"
	}

	taxonomyJSON, err := json.Marshal(req.Taxonomy)
	if err != nil {
		return nil, twirp.InvalidArgumentError("taxonomy", "failed to marshal taxonomy")
	}

	// Workflows are inert at create time. The contract documented in
	// `docs/workflow/api.md` (and relied on by the UI) is "always false
	// on create; enable via setWorkflowEnabled" — the request's
	// `enabled` field is ignored so callers can't accidentally ship a
	// workflow live before they intend to.
	wf := &models.WorkflowDefinition{
		ID:            uuid.New(),
		ApplicationID: applicationID,
		Name:          req.Name,
		Steps:         stepsJSON,
		Trigger:       triggerJSON,
		CreatedByType: createdByType,
		CreatedByRef:  req.CreatedByRef,
		ManifestID:    req.ManifestId,
		Taxonomy:      string(taxonomyJSON),
		Enabled:       false,
	}

	// MODULE-owned workflows (non-empty ManifestID) upsert on
	// (created_by_type, created_by_ref, manifest_id) so a module upgrade
	// updates the existing workflow in place instead of duplicating it.
	// USER-authored workflows always insert — ManifestID is empty and
	// isn't covered by that unique index.
	if createdByType == "MODULE" && wf.ManifestID != "" {
		err = s.workflowRepo.Upsert(wf)
	} else {
		err = s.workflowRepo.Create(wf)
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create workflow: %w", err))
	}

	s.syncWorkflowEdges(wf, wf.CreatedByType, wf.CreatedByRef)

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   appIDStr,
			EntityType:      "workflow",
			EntityID:        wf.ID.String(),
			Operation:       "created",
			Data:            buildWorkflowChangeData(wf),
			AutoAcknowledge: true,
		})
	}

	return &client.WorkflowResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow created successfully",
		},
		Workflow: s.workflowToProto(wf),
	}, nil
}

func (s *workflowService) GetWorkflow(ctx context.Context, req *client.GetWorkflowRequest) (*client.WorkflowResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	wf, err := s.workflowRepo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("workflow not found")
	}

	return &client.WorkflowResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow retrieved successfully",
		},
		Workflow: s.workflowToProto(wf),
	}, nil
}

func (s *workflowService) UpdateWorkflow(ctx context.Context, req *client.UpdateWorkflowRequest) (*client.WorkflowResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	wf, err := s.workflowRepo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("workflow not found")
	}

	// Update fields. Patch semantics: scalar fields with non-zero values
	// overwrite; zero values are treated as "not set" (legacy contract
	// — see UpdateWorkflowRequest doc in workflow.proto). `enabled` is
	// proto3-`optional` so we can distinguish "do not touch" (nil) from
	// "set to false" (`*v == false`); the dedicated UI toggle relies on
	// this to disable a workflow without rewriting any other field.
	if req.Name != "" {
		wf.Name = req.Name
	}

	if req.StepsJson != "" {
		wf.Steps = req.StepsJson
	}
	if req.TriggerJson != "" {
		wf.Trigger = req.TriggerJson
	}
	if req.Enabled != nil {
		wf.Enabled = *req.Enabled
	}

	err = s.workflowRepo.Update(wf)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update workflow: %w", err))
	}

	// UpdateWorkflow does not re-carry created_by metadata in the request;
	// origin is set at create time and is immutable. Re-sync the edge set
	// using whatever the row already has, so module-owned workflows keep
	// their MODULE attribution after an update.
	s.syncWorkflowEdges(wf, wf.CreatedByType, wf.CreatedByRef)

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   wf.ApplicationID.String(),
			EntityType:      "workflow",
			EntityID:        wf.ID.String(),
			Operation:       "updated",
			Data:            buildWorkflowChangeData(wf),
			AutoAcknowledge: true,
		})
	}

	return &client.WorkflowResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow updated successfully",
		},
		Workflow: s.workflowToProto(wf),
	}, nil
}

func (s *workflowService) DeleteWorkflow(ctx context.Context, req *client.DeleteWorkflowRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	wf, err := s.workflowRepo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("workflow not found")
	}

	applicationID := wf.ApplicationID.String()
	workflowID := wf.ID.String()

	err = s.workflowRepo.Delete(wf)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete workflow: %w", err))
	}

	if s.refRepo != nil {
		if err := s.refRepo.DeleteEdgesBySource("workflow", wf.ID); err != nil {
			log.Printf("workflow_service: DeleteEdgesBySource failed for workflow %s: %v", workflowID, err)
		}
	}

	if s.publisher != nil {
		// Echo projectionKey on deletes too so the UI can dedupe a delete
		// that arrives from multiple engine instances pointing at the same
		// projection row. Empty for USER-authored workflows (no projection).
		deletePayload := map[string]any{"id": workflowID}
		if pk := projectionKeyFor(wf.CreatedByType, wf.CreatedByRef, "workflow", wf.ManifestID); pk != "" {
			deletePayload["projection_key"] = pk
		}
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   applicationID,
			EntityType:      "workflow",
			EntityID:        workflowID,
			Operation:       "deleted",
			Data:            deletePayload,
			AutoAcknowledge: true,
		})
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Workflow deleted successfully",
	}, nil
}

func (s *workflowService) ListWorkflows(ctx context.Context, req *client.ListWorkflowsRequest) (*client.ListWorkflowsResponse, error) {
	var workflows []*models.WorkflowDefinition
	var err error

	if req.ApplicationId != "" {
		appID, err := uuid.Parse(req.ApplicationId)
		if err != nil {
			return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
		}

		if req.IncludeDisabled {
			workflows, err = s.workflowRepo.GetByApplicationID(appID)
		} else {
			workflows, err = s.workflowRepo.GetByApplicationIDAndEnabled(appID, true)
		}
	} else {
		workflows, err = s.workflowRepo.GetAll()
	}

	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list workflows: %w", err))
	}

	protoWorkflows := make([]*client.Workflow, len(workflows))
	for i, wf := range workflows {
		protoWorkflows[i] = s.workflowToProto(wf)
	}

	return &client.ListWorkflowsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflows retrieved successfully",
		},
		Workflows:  protoWorkflows,
		TotalCount: int32(len(protoWorkflows)),
		Page:       req.Page,
		PageSize:   req.PageSize,
	}, nil
}

func (s *workflowService) ExecuteWorkflow(ctx context.Context, req *client.ExecuteWorkflowRequest) (*client.ExecuteWorkflowResponse, error) {
	workflowID, err := uuid.Parse(req.WorkflowId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("workflow_id", "invalid UUID format")
	}

	appIDStr, err := resolveApplicationID(ctx, s.workflowRepo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}

	// Get workflow to verify it exists
	_, err = s.workflowRepo.GetByID(workflowID)
	if err != nil {
		return nil, twirp.NotFoundError("workflow not found")
	}

	// Marshal inputs - ensure valid JSON (empty object if nil/empty)
	inputsJSON := "{}"
	if len(req.Inputs) > 0 {
		jsonBytes, err := json.Marshal(req.Inputs)
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("failed to marshal inputs: %w", err))
		}
		inputsJSON = string(jsonBytes)
	}

	// Create execution record
	var startedByID uuid.UUID
	if req.StartedBy != "" {
		startedByID, err = uuid.Parse(req.StartedBy)
		if err != nil {
			return nil, twirp.InvalidArgumentError("started_by", "invalid UUID format")
		}
	}

	exec := &models.WorkflowExecution{
		ID:            uuid.New(),
		WorkflowID:    workflowID,
		ApplicationID: applicationID,
		UserID:        startedByID,
		Status:        models.WorkflowStatusPending,
		Input:         inputsJSON,
		Output:        "{}",
	}

	err = exec.Create(s.executionRepo)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create execution: %w", err))
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   appIDStr,
			EntityType:      "workflow_execution",
			EntityID:        exec.ID.String(),
			Operation:       "created",
			Data:            exec,
			AutoAcknowledge: true,
		})
	}

	return &client.ExecuteWorkflowResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow execution started",
		},
		ExecutionId: exec.ID.String(),
		Async:       req.Async,
	}, nil
}

func (s *workflowService) GetWorkflowExecution(ctx context.Context, req *client.GetWorkflowExecutionRequest) (*client.WorkflowExecutionResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	exec, err := models.GetWorkflowExecutionByID(s.executionRepo, id)
	if err != nil {
		return nil, twirp.NotFoundError("workflow execution not found")
	}

	return &client.WorkflowExecutionResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow execution retrieved successfully",
		},
		Execution: s.executionToProto(exec),
	}, nil
}

func (s *workflowService) ListWorkflowExecutions(ctx context.Context, req *client.ListWorkflowExecutionsRequest) (*client.ListWorkflowExecutionsResponse, error) {
	// TODO: Implement filtering logic based on request parameters
	executions, err := models.GetRecentWorkflowExecutions(s.executionRepo, int(req.PageSize))
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list executions: %w", err))
	}

	protoExecutions := make([]*client.WorkflowExecution, len(executions))
	for i, exec := range executions {
		protoExecutions[i] = s.executionToProto(&exec)
	}

	return &client.ListWorkflowExecutionsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow executions retrieved successfully",
		},
		Executions: protoExecutions,
		TotalCount: int32(len(protoExecutions)),
		Page:       req.Page,
		PageSize:   req.PageSize,
	}, nil
}

func (s *workflowService) CancelWorkflowExecution(ctx context.Context, req *client.CancelWorkflowExecutionRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	exec, err := models.GetWorkflowExecutionByID(s.executionRepo, id)
	if err != nil {
		return nil, twirp.NotFoundError("workflow execution not found")
	}

	err = exec.MarkAsCancelled(s.executionRepo)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to cancel execution: %w", err))
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   exec.ApplicationID.String(),
			EntityType:      "workflow_execution",
			EntityID:        exec.ID.String(),
			Operation:       "cancelled",
			Data:            exec,
			AutoAcknowledge: true,
		})
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Workflow execution cancelled successfully",
	}, nil
}

// RecordWorkflowRun records a run the engine has already started.
//
// Distinct from ExecuteWorkflow, which asked for a run and left a `pending` row
// for something to pick up: nothing ever did. Here the engine owns the id and
// is reporting a run already underway, so the row is written `running` -- there
// is no queue and nothing downstream to start it.
//
// The owning user is resolved from the application rather than supplied by the
// caller. A run triggered by a Twitch follow is attributable to an account but
// to no person, and the engine has no notion of users at all.
func (s *workflowService) RecordWorkflowRun(ctx context.Context, req *client.RecordWorkflowRunRequest) (*client.WorkflowExecutionResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	workflowID, err := uuid.Parse(req.WorkflowId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("workflow_id", "invalid UUID format")
	}

	appIDStr, err := resolveApplicationID(ctx, s.executionRepo, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}

	app, err := models.GetApplicationByID(s.executionRepo, applicationID)
	if err != nil {
		return nil, twirp.NotFoundError("application not found")
	}

	startedAt := time.Now()
	if req.StartedAt != nil {
		startedAt = req.StartedAt.AsTime()
	}

	exec := &models.WorkflowExecution{
		ID:            id,
		WorkflowID:    workflowID,
		ApplicationID: applicationID,
		UserID:        app.UserID,
		Status:        models.WorkflowStatusRunning,
		Input:         "{}",
		Output:        "{}",
		TriggerEvent:  jsonOrEmptyObject(req.TriggerEventJson),
		TriggeredBy:   req.TriggeredBy,
		StartedAt:     &startedAt,
	}
	if err := exec.Create(s.executionRepo); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record workflow run: %w", err))
	}

	s.publishExecution(exec, "created")

	return &client.WorkflowExecutionResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow run recorded",
		},
		Execution: s.executionToProto(exec),
	}, nil
}

// UpdateWorkflowRunStatus advances a recorded run to its terminal state.
func (s *workflowService) UpdateWorkflowRunStatus(ctx context.Context, req *client.UpdateWorkflowRunStatusRequest) (*client.WorkflowExecutionResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	exec, err := models.GetWorkflowExecutionByID(s.executionRepo, id)
	if err != nil {
		return nil, twirp.NotFoundError("workflow execution not found")
	}

	exec.Status = models.WorkflowExecutionStatus(req.Status)
	if req.Error != "" {
		exec.Error = req.Error
	}
	if req.OutputJson != "" {
		exec.Output = req.OutputJson
	}

	// Only a terminal state carries a completion time. A run still reported as
	// running has not finished, and stamping one would make it look as though
	// it had to everything that reads these rows.
	switch exec.Status {
	case models.WorkflowStatusCompleted, models.WorkflowStatusFailed, models.WorkflowStatusCancelled:
		completedAt := time.Now()
		if req.CompletedAt != nil {
			completedAt = req.CompletedAt.AsTime()
		}
		exec.CompletedAt = &completedAt
	}

	if err := exec.Update(s.executionRepo); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update workflow run: %w", err))
	}

	s.publishExecution(exec, "updated")

	return &client.WorkflowExecutionResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Workflow run updated",
		},
		Execution: s.executionToProto(exec),
	}, nil
}

// RecordWorkflowRunStep records one step's outcome within a recorded run.
//
// Upserted rather than inserted: a step is reported twice per attempt, once
// when it starts and once when it settles, and both describe the same attempt.
func (s *workflowService) RecordWorkflowRunStep(ctx context.Context, req *client.RecordWorkflowRunStepRequest) (*client.ResponseStatus, error) {
	executionID, err := uuid.Parse(req.ExecutionId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("execution_id", "invalid UUID format")
	}

	appIDStr, err := resolveApplicationID(ctx, s.executionRepo, req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}

	if req.TaskId == "" {
		return nil, twirp.RequiredArgumentError("task_id")
	}

	// The column requires a positive attempt. An unset field means the caller
	// does not track retries, which is the first attempt.
	attempt := int(req.Attempt)
	if attempt < 1 {
		attempt = 1
	}

	step := &models.WorkflowExecutionStep{
		ID:            uuid.New(),
		ExecutionID:   executionID,
		ApplicationID: applicationID,
		TaskID:        req.TaskId,
		Name:          req.Name,
		Status:        req.Status,
		Attempt:       attempt,
		StepIndex:     int(req.StepIndex),
		Inputs:        jsonOrEmptyObject(req.InputsJson),
		Outputs:       jsonOrEmptyObject(req.OutputsJson),
		Error:         req.Error,
		DurationMs:    req.DurationMs,
	}
	if req.StartedAt != nil {
		startedAt := req.StartedAt.AsTime()
		step.StartedAt = &startedAt
	}
	if req.CompletedAt != nil {
		completedAt := req.CompletedAt.AsTime()
		step.CompletedAt = &completedAt
	}

	if err := models.UpsertWorkflowExecutionStep(s.executionRepo, step); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record workflow run step: %w", err))
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   applicationID.String(),
			EntityType:      "workflow_execution_step",
			EntityID:        step.ID.String(),
			Operation:       "recorded",
			Data:            step,
			AutoAcknowledge: true,
		})
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Workflow run step recorded",
	}, nil
}

// publishExecution announces a run row change on the outbox.
func (s *workflowService) publishExecution(exec *models.WorkflowExecution, operation string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		ApplicationID:   exec.ApplicationID.String(),
		EntityType:      "workflow_execution",
		EntityID:        exec.ID.String(),
		Operation:       operation,
		Data:            exec,
		AutoAcknowledge: true,
	})
}

// jsonOrEmptyObject keeps a JSONB column valid. An empty string is not JSON,
// and a step with no parameters legitimately has nothing to record.
func jsonOrEmptyObject(raw string) string {
	if raw == "" {
		return "{}"
	}
	return raw
}

// Helper functions to convert between database models and protobuf messages

func (s *workflowService) workflowToProto(wf *models.WorkflowDefinition) *client.Workflow {
	var createdAt, updatedAt *timestamppb.Timestamp

	var taxonomy []string
	if wf.Taxonomy != "" {
		json.Unmarshal([]byte(wf.Taxonomy), &taxonomy)
	}
	if taxonomy == nil {
		taxonomy = []string{}
	}

	// `steps_json` and `trigger_json` are the canonical workflow shape
	// the engine consumes. The typed `WorkflowStep` proto array was
	// removed in favor of these JSON columns.
	return &client.Workflow{
		Id:            wf.ID.String(),
		Name:          wf.Name,
		ApplicationId: wf.ApplicationID.String(),
		Enabled:       wf.Enabled,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
		StepsJson:     wf.Steps,
		TriggerJson:   wf.Trigger,
		CreatedByType: wf.CreatedByType,
		CreatedByRef:  wf.CreatedByRef,
		ManifestId:    wf.ManifestID,
		Taxonomy:      taxonomy,
	}
}

func (s *workflowService) executionToProto(exec *models.WorkflowExecution) *client.WorkflowExecution {
	// Unmarshal inputs/outputs from JSON
	var inputs, outputs map[string]string
	if exec.Input != "" {
		json.Unmarshal([]byte(exec.Input), &inputs)
	}
	if exec.Output != "" {
		json.Unmarshal([]byte(exec.Output), &outputs)
	}

	var startedAt, completedAt, createdAt, updatedAt *timestamppb.Timestamp
	if exec.StartedAt != nil {
		startedAt = timestamppb.New(*exec.StartedAt)
	}
	if exec.CompletedAt != nil {
		completedAt = timestamppb.New(*exec.CompletedAt)
	}
	if !exec.CreatedAt.IsZero() {
		createdAt = timestamppb.New(exec.CreatedAt)
	}
	if !exec.UpdatedAt.IsZero() {
		updatedAt = timestamppb.New(exec.UpdatedAt)
	}

	return &client.WorkflowExecution{
		Id:            exec.ID.String(),
		WorkflowId:    exec.WorkflowID.String(),
		Status:        string(exec.Status),
		StartedBy:     exec.UserID.String(),
		ApplicationId: exec.ApplicationID.String(),
		Inputs:        inputs,
		Outputs:       outputs,
		Error:         exec.Error,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
		Steps:         s.executionSteps(exec.ID),
	}
}

// executionSteps returns a run's steps in the order it ran them.
//
// A read failure yields no steps rather than failing the lookup: the run itself
// is what the caller asked for, and a timeline missing its detail is more
// useful than an error page.
func (s *workflowService) executionSteps(executionID uuid.UUID) []*client.ExecutionStep {
	steps, err := models.GetWorkflowExecutionSteps(s.executionRepo, executionID)
	if err != nil {
		log.Printf("workflow run steps unavailable for %s: %v", executionID, err)
		return []*client.ExecutionStep{}
	}

	out := make([]*client.ExecutionStep, len(steps))
	for i := range steps {
		out[i] = stepToProto(&steps[i])
	}
	return out
}

func stepToProto(step *models.WorkflowExecutionStep) *client.ExecutionStep {
	var startedAt, completedAt *timestamppb.Timestamp
	if step.StartedAt != nil {
		startedAt = timestamppb.New(*step.StartedAt)
	}
	if step.CompletedAt != nil {
		completedAt = timestamppb.New(*step.CompletedAt)
	}

	return &client.ExecutionStep{
		StepId:      step.TaskID,
		Name:        step.Name,
		Status:      step.Status,
		Attempt:     int32(step.Attempt),
		StepIndex:   int32(step.StepIndex),
		InputsJson:  step.Inputs,
		OutputsJson: step.Outputs,
		Error:       step.Error,
		StartedAt:   startedAt,
		CompletedAt: completedAt,
		DurationMs:  step.DurationMs,
	}
}
