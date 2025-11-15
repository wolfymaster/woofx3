package services

// import (
// 	"context"
// 	"encoding/json"
// 	"fmt"
// 	"time"

// 	"gorm.io/gorm"
// 	"github.com/google/uuid"

// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type workflowService struct {
// 	baseService[models.WorkflowExecution]
// 	commandService CommandService
// 	eventService   EventService
// }

// // NewWorkflowService creates a new instance of WorkflowService
// func NewWorkflowService(commandService CommandService, eventService EventService) WorkflowService {
// 	return &workflowService{
// 		baseService:    baseService[models.WorkflowExecution]{},
// 		commandService: commandService,
// 		eventService:   eventService,
// 	}
// }

// // GetWorkflowDefinition retrieves a workflow definition by ID
// func (s *workflowService) GetWorkflowDefinition(db *gorm.DB, id uuid.UUID) (*models.WorkflowDefinition, error) {
// 	var def models.WorkflowDefinition
// 	err := db.First(&def, "id = ?", id).Error
// 	if err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			return nil, fmt.Errorf("workflow definition not found")
// 		}
// 		return nil, fmt.Errorf("failed to get workflow definition: %w", err)
// 	}

// 	return &def, nil
// }

// // CreateWorkflowDefinition creates a new workflow definition
// func (s *workflowService) CreateWorkflowDefinition(db *gorm.DB, def *models.WorkflowDefinition) error {
// 	// Validate the workflow definition
// 	if err := s.validateWorkflowDefinition(def); err != nil {
// 		return fmt.Errorf("invalid workflow definition: %w", err)
// 	}

// 	// Set default values
// 	def.ID = uuid.New()
// 	def.CreatedAt = time.Now()
// 	def.UpdatedAt = time.Now()

// 	return db.Create(def).Error
// }

// // UpdateWorkflowDefinition updates an existing workflow definition
// func (s *workflowService) UpdateWorkflowDefinition(db *gorm.DB, def *models.WorkflowDefinition) error {
// 	// Validate the workflow definition
// 	if err := s.validateWorkflowDefinition(def); err != nil {
// 		return fmt.Errorf("invalid workflow definition: %w", err)
// 	}

// 	// Update the updated_at timestamp
// 	def.UpdatedAt = time.Now()

// 	return db.Save(def).Error
// }

// // DeleteWorkflowDefinition deletes a workflow definition
// func (s *workflowService) DeleteWorkflowDefinition(db *gorm.DB, id uuid.UUID) error {
// 	// Check if there are any active workflow executions
// 	var count int64
// 	if err := db.Model(&models.WorkflowExecution{}).
// 		Where("workflow_definition_id = ? AND status IN (?)", id, []string{"pending", "running"}).
// 		Count(&count).Error; err != nil {
// 		return fmt.Errorf("failed to check active executions: %w", err)
// 	}

// 	if count > 0 {
// 		return fmt.Errorf("cannot delete workflow with active executions")
// 	}

// 	// Delete the workflow definition
// 	return db.Delete(&models.WorkflowDefinition{}, "id = ?", id).Error
// }

// // ExecuteWorkflow starts a new workflow execution
// func (s *workflowService) ExecuteWorkflow(
// 	db *gorm.DB,
// 	workflowDefID uuid.UUID,
// 	userID uuid.UUID,
// 	input map[string]interface{},
// ) (*models.WorkflowExecution, error) {
// 	// Get the workflow definition
// 	def, err := s.GetWorkflowDefinition(db, workflowDefID)
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to get workflow definition: %w", err)
// 	}

// 	// Create a new workflow execution
// 	execution := &models.WorkflowExecution{
// 		ID:                   uuid.New(),
// 		WorkflowDefinitionID: workflowDefID,
// 		UserID:              userID,
// 		Status:              "pending",
// 		Input:               input,
// 		StartedAt:           time.Now(),
// 		CreatedAt:           time.Now(),
// 	}

// 	// Start a transaction
// 	err = db.Transaction(func(tx *gorm.DB) error {
// 		// Save the execution
// 		if err := tx.Create(execution).Error; err != nil {
// 			return fmt.Errorf("failed to create workflow execution: %w", err)
// 		}

// 		// Log the workflow start event
// 		event := &models.UserEvent{
// 			ID:            uuid.New(),
// 			UserID:        userID,
// 			EventType:     "workflow_started",
// 			EventData:     map[string]interface{}{"workflow_definition_id": workflowDefID},
// 			ApplicationID: def.ApplicationID,
// 			CreatedAt:     time.Now(),
// 		}

// 		if err := s.eventService.LogEvent(tx, event); err != nil {
// 			return fmt.Errorf("failed to log workflow start event: %w", err)
// 		}

// 		// Start the workflow execution in the background
// 		// This is a simplified example - in a real implementation, you might use a message queue
// 		go s.executeWorkflowSteps(db, execution, def, userID)

// 		return nil
// 	})

// 	if err != nil {
// 		return nil, err
// 	}

// 	return execution, nil
// }

// // GetWorkflowExecution retrieves a workflow execution by ID
// func (s *workflowService) GetWorkflowExecution(db *gorm.DB, id uuid.UUID) (*models.WorkflowExecution, error) {
// 	var exec models.WorkflowExecution
// 	err := db.First(&exec, "id = ?", id).Error
// 	if err != nil {
// 		if err == gorm.ErrRecordNotFound {
// 			return nil, fmt.Errorf("workflow execution not found")
// 		}
// 		return nil, fmt.Errorf("failed to get workflow execution: %w", err)
// 	}

// 	return &exec, nil
// }

// // executeWorkflowSteps executes the steps of a workflow
// func (s *workflowService) executeWorkflowSteps(
// 	db *gorm.DB,
// 	execution *models.WorkflowExecution,
// 	def *models.WorkflowDefinition,
// 	userID uuid.UUID,
// ) {
// 	// Update the execution status to running
// 	err := db.Model(execution).
// 		Update("status", "running").
// 		Update("started_at", time.Now()).
// 		Error

// 	if err != nil {
// 		s.logWorkflowError(db, execution.ID, userID, def.ApplicationID, "failed to start workflow execution", err)
// 		return
// 	}

// 	// Parse the workflow steps
// 	var steps []map[string]interface{}
// 	if err := json.Unmarshal(def.Steps, &steps); err != nil {
// 		s.logWorkflowError(db, execution.ID, userID, def.ApplicationID, "invalid workflow steps", err)
// 		return
// 	}

// 	// Execute each step
// 	results := make([]map[string]interface{}, 0, len(steps))
// 	for i, step := range steps {
// 		stepResult, err := s.executeWorkflowStep(db, execution, step, userID, def.ApplicationID)
// 		if err != nil {
// 			s.logWorkflowError(db, execution.ID, userID, def.ApplicationID, 
// 				fmt.Sprintf("step %d failed", i+1), err)
// 			return
// 		}
// 		results = append(results, stepResult)

// 		// Check if we should continue
// 		if shouldStop, ok := stepResult["shouldStop"].(bool); ok && shouldStop {
// 			break
// 		}
// 	}

// 	// Update the execution status to completed
// 	err = db.Model(execution).
// 		Update("status", "completed").
// 		Update("completed_at", time.Now()).
// 		Update("results", results).
// 		Error

// 	if err != nil {
// 		s.logWorkflowError(db, execution.ID, userID, def.ApplicationID, 
// 			"failed to complete workflow execution", err)
// 		return
// 	}

// 	// Log the workflow completion event
// 	event := &models.UserEvent{
// 		ID:            uuid.New(),
// 		UserID:        userID,
// 		EventType:     "workflow_completed",
// 		EventData:     map[string]interface{}{"workflow_execution_id": execution.ID},
// 		ApplicationID: def.ApplicationID,
// 		CreatedAt:     time.Now(),
// 	}

// 	_ = s.eventService.LogEvent(db, event) // Best effort
// }

// // executeWorkflowStep executes a single workflow step
// func (s *workflowService) executeWorkflowStep(
// 	db *gorm.DB,
// 	execution *models.WorkflowExecution,
// 	step map[string]interface{},
// 	userID uuid.UUID,
// 	appID uuid.UUID,
// ) (map[string]interface{}, error) {
// 	// This is a simplified example - in a real implementation, you would handle different step types
// 	// and execute the appropriate actions based on the step configuration

// 	stepType, ok := step["type"].(string)
// 	if !ok {
// 		return nil, fmt.Errorf("missing or invalid step type")
// 	}

// 	switch stepType {
// 	case "command":
// 		return s.executeCommandStep(db, step, userID, appID)
// 	// Add more step types as needed
// 	default:
// 		return nil, fmt.Errorf("unsupported step type: %s", stepType)
// 	}
// }

// // executeCommandStep executes a command step
// func (s *workflowService) executeCommandStep(
// 	db *gorm.DB,
// 	step map[string]interface{},
// 	userID uuid.UUID,
// 	appID uuid.UUID,
// ) (map[string]interface{}, error) {
// 	// Extract command details from the step
// 	commandName, ok := step["command"].(string)
// 	if !ok {
// 		return nil, fmt.Errorf("missing or invalid command name")
// 	}

// 	// Extract command arguments
// 	args := make([]interface{}, 0)
// 	if argsVal, ok := step["args"]; ok {
// 		if argsSlice, ok := argsVal.([]interface{}); ok {
// 			args = argsSlice
// 		}
// 	}

// 	// Execute the command
// 	result, err := s.commandService.ExecuteCommand(db, userID, commandName, args...)
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to execute command: %w", err)
// 	}

// 	// Log the command execution
// 	event := &models.UserEvent{
// 		ID:            uuid.New(),
// 		UserID:        userID,
// 		EventType:     "command_executed",
// 		EventData:     map[string]interface{}{"command": commandName, "args": args},
// 		ApplicationID: appID,
// 		CreatedAt:     time.Now(),
// 	}

// 	_ = s.eventService.LogEvent(db, event) // Best effort

// 	return map[string]interface{}{
// 		"success":   true,
// 		"command":   commandName,
// 		"result":    result,
// 		"timestamp": time.Now(),
// 	}, nil
// }

// // validateWorkflowDefinition validates a workflow definition
// func (s *workflowService) validateWorkflowDefinition(def *models.WorkflowDefinition) error {
// 	if def.Name == "" {
// 		return fmt.Errorf("name is required")
// 	}

// 	if def.ApplicationID == uuid.Nil {
// 		return fmt.Errorf("application ID is required")
// 	}

// 	// Validate the steps JSON
// 	var steps []interface{}
// 	if err := json.Unmarshal(def.Steps, &steps); err != nil {
// 		return fmt.Errorf("invalid steps JSON: %w", err)
// 	}

// 	// Additional validation of steps could be added here

// 	return nil
// }

// // logWorkflowError logs a workflow error and updates the execution status
// func (s *workflowService) logWorkflowError(
// 	db *gorm.DB,
// 	executionID uuid.UUID,
// 	userID uuid.UUID,
// 	appID uuid.UUID,
// 	message string,
// 	err error,
// ) {
// 	// Update the execution status to failed
// 	_ = db.Model(&models.WorkflowExecution{}).
// 		Where("id = ?", executionID).
// 		Updates(map[string]interface{}{
// 			"status":      "failed",
// 			"completed_at": time.Now(),
// 			"error":       message + ": " + err.Error(),
// 		}).Error

// 	// Log the error event
// 	event := &models.UserEvent{
// 		ID:            uuid.New(),
// 		UserID:        userID,
// 		EventType:     "workflow_error",
// 		EventData:     map[string]interface{}{"workflow_execution_id": executionID, "error": message, "details": err.Error()},
// 		ApplicationID: appID,
// 		CreatedAt:     time.Now(),
// 	}

// 	_ = s.eventService.LogEvent(db, event) // Best effort
// }

// // ListWorkflowExecutions retrieves a list of workflow executions
// func (s *workflowService) ListWorkflowExecutions(
// 	db *gorm.DB,
// 	workflowDefID *uuid.UUID,
// 	userID *uuid.UUID,
// 	status *string,
// 	limit int,
// 	offset int,
// ) ([]models.WorkflowExecution, int64, error) {
// 	var executions []models.WorkflowExecution
// 	var count int64

// 	query := db.Model(&models.WorkflowExecution{})

// 	if workflowDefID != nil {
// 		query = query.Where("workflow_definition_id = ?", *workflowDefID)
// 	}

// 	if userID != nil {
// 		query = query.Where("user_id = ?", *userID)
// 	}

// 	if status != nil {
// 		query = query.Where("status = ?", *status)
// 	}

// 	// Get total count
// 	if err := query.Count(&count).Error; err != nil {
// 		return nil, 0, fmt.Errorf("failed to count workflow executions: %w", err)
// 	}

// 	// Get paginated results
// 	if limit > 0 {
// 		query = query.Limit(limit)
// 	}

// 	if offset > 0 {
// 		query = query.Offset(offset)
// 	}

// 	query = query.Order("created_at DESC")

// 	if err := query.Find(&executions).Error; err != nil {
// 		return nil, 0, fmt.Errorf("failed to list workflow executions: %w", err)
// 	}

// 	return executions, count, nil
// }
