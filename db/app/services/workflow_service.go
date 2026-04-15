package services

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
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
}

func NewWorkflowService(workflowRepo *repo.WorkflowRepository, db interface{}, publisher *workers.EventPublisher) client.WorkflowService {
	var dbConn *gorm.DB
	if gormDB, ok := db.(*gorm.DB); ok {
		dbConn = gormDB
	}

	return &workflowService{
		workflowRepo:  workflowRepo,
		executionRepo: dbConn,
		publisher:     publisher,
	}
}

func (s *workflowService) CreateWorkflow(ctx context.Context, req *client.CreateWorkflowRequest) (*client.WorkflowResponse, error) {
	applicationID, err := uuid.Parse(req.ApplicationId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}

	stepsJSON := "[]"
	if raw, ok := req.Variables["_steps"]; ok && raw != "" {
		stepsJSON = raw
	} else if req.Steps != nil {
		b, err := json.Marshal(req.Steps)
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("failed to marshal steps: %w", err))
		}
		stepsJSON = string(b)
	}

	triggerJSON := "{}"
	if raw, ok := req.Variables["_trigger"]; ok && raw != "" {
		triggerJSON = raw
	}

	wf := &models.WorkflowDefinition{
		ApplicationID: applicationID,
		Name:          req.Name,
		Steps:         stepsJSON,
		Trigger:       triggerJSON,
	}

	err = s.workflowRepo.Create(wf)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create workflow: %w", err))
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   req.ApplicationId,
			EntityType:      "workflow",
			EntityID:        wf.ID.String(),
			Operation:       "created",
			Data:            wf,
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

	// Update fields
	if req.Name != "" {
		wf.Name = req.Name
	}

	if raw, ok := req.Variables["_steps"]; ok && raw != "" {
		wf.Steps = raw
	} else if req.Steps != nil {
		stepsJSON, err := json.Marshal(req.Steps)
		if err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("failed to marshal steps: %w", err))
		}
		wf.Steps = string(stepsJSON)
	}

	if raw, ok := req.Variables["_trigger"]; ok && raw != "" {
		wf.Trigger = raw
	}

	err = s.workflowRepo.Update(wf)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update workflow: %w", err))
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   wf.ApplicationID.String(),
			EntityType:      "workflow",
			EntityID:        wf.ID.String(),
			Operation:       "updated",
			Data:            wf,
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

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   applicationID,
			EntityType:      "workflow",
			EntityID:        workflowID,
			Operation:       "deleted",
			Data:            map[string]string{"id": workflowID},
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

	applicationID, err := uuid.Parse(req.ApplicationId)
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
			ApplicationID:   req.ApplicationId,
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

// Helper functions to convert between database models and protobuf messages

func (s *workflowService) workflowToProto(wf *models.WorkflowDefinition) *client.Workflow {
	variables := map[string]string{
		"_steps":   wf.Steps,
		"_trigger": wf.Trigger,
	}

	var createdAt, updatedAt *timestamppb.Timestamp

	return &client.Workflow{
		Id:            wf.ID.String(),
		Name:          wf.Name,
		ApplicationId: wf.ApplicationID.String(),
		Steps:         nil,
		Enabled:       true,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
		Variables:     variables,
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
		Steps:         []*client.ExecutionStep{}, // TODO: Populate execution steps
	}
}
