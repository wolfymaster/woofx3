package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wolfymaster/woofx3/workflow/internal/adapters/postgres"
	"github.com/wolfymaster/woofx3/workflow/internal/core"
	"github.com/wolfymaster/woofx3/workflow/internal/testutil"
)

func TestWorkflowExecution(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-1",
		Name:        "Test Workflow",
		Description: "Test workflow for integration tests",
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Wait Step",
				Action: "wait",
				Parameters: map[string]interface{}{
					"duration": "1s",
				},
				NextStep: "step2",
			},
			{
				ID:     "step2",
				Name:   "Aggregate Step",
				Action: "aggregate",
				Parameters: map[string]interface{}{
					"window": "1m",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Start workflow
	input := map[string]interface{}{
		"test": "data",
	}
	err = engine.StartWorkflow(context.Background(), definition.ID, input)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(2 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Equal(t, input, status.Input)
	require.NotEmpty(t, status.Output)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}

func TestWorkflowExecution_ErrorHandling(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition with error handling
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-2",
		Name:        "Error Handling Workflow",
		Description: "Test workflow with error handling",
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Failing Step",
				Action: "http",
				Parameters: map[string]interface{}{
					"url": "http://invalid-url",
				},
				ErrorStep: "error-step",
			},
			{
				ID:     "error-step",
				Name:   "Error Handler",
				Action: "wait",
				Parameters: map[string]interface{}{
					"duration": "1s",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Start workflow
	input := map[string]interface{}{
		"test": "data",
	}
	err = engine.StartWorkflow(context.Background(), definition.ID, input)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(2 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Equal(t, input, status.Input)
	require.Contains(t, status.Output, "error-step")
	require.NotEmpty(t, status.Error)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}

func TestWorkflowExecution_EventTrigger(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-3",
		Name:        "Event Trigger Workflow",
		Description: "Test workflow triggered by events",
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Wait for Event",
				Action: "wait",
				Parameters: map[string]interface{}{
					"duration": "1s",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Create and publish event
	event := core.Event{
		ID:   "test-event-4",
		Type: "bits",
		Data: map[string]interface{}{
			"type":      "bits",
			"amount":    100,
			"username":  "testuser",
			"timestamp": "2024-01-20T12:00:00Z",
		},
		CreatedAt: time.Now(),
	}

	// Handle event
	err = engine.HandleEvent(context.Background(), event)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(2 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Contains(t, status.Input, "event")
	require.NotEmpty(t, status.Output)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}

func TestWorkflowExecution_ActionStep(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-1",
		Name:        "Action Step Workflow",
		Description: "Test workflow with action step",
		Trigger: &core.Trigger{
			Type:  "event",
			Event: "bits",
		},
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Play Sound",
				Action: "play_sound",
				Parameters: map[string]interface{}{
					"sound": "cheer.mp3",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Create and publish event
	event := core.Event{
		ID:   "test-event-1",
		Type: "bits",
		Data: map[string]interface{}{
			"type":      "bits",
			"amount":    100,
			"username":  "testuser",
			"timestamp": "2024-01-20T12:00:00Z",
		},
		CreatedAt: time.Now(),
	}

	// Handle event
	err = engine.HandleEvent(context.Background(), event)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(2 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Contains(t, status.Input, "event")
	require.NotEmpty(t, status.Output)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}

func TestWorkflowExecution_WaitStep(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-2",
		Name:        "Wait Step Workflow",
		Description: "Test workflow with wait step",
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Wait Step",
				Action: "wait",
				Parameters: map[string]interface{}{
					"duration": "1s",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Start workflow
	input := map[string]interface{}{
		"test": "data",
	}
	err = engine.StartWorkflow(context.Background(), definition.ID, input)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(2 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Equal(t, input, status.Input)
	require.NotEmpty(t, status.Output)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}

func TestWorkflowExecution_ConditionStep(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-3",
		Name:        "Condition Step Workflow",
		Description: "Test workflow with condition step",
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Condition Step",
				Action: "condition",
				Parameters: map[string]interface{}{
					"condition": "amount >= 100",
				},
				NextStep: "step2",
			},
			{
				ID:     "step2",
				Name:   "Success Step",
				Action: "wait",
				Parameters: map[string]interface{}{
					"duration": "1s",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Start workflow
	input := map[string]interface{}{
		"amount": 100,
	}
	err = engine.StartWorkflow(context.Background(), definition.ID, input)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(2 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Equal(t, input, status.Input)
	require.NotEmpty(t, status.Output)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}

func TestWorkflowExecution_LoopStep(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create workflow definition
	definition := &core.WorkflowDefinition{
		ID:          "test-workflow-4",
		Name:        "Loop Step Workflow",
		Description: "Test workflow with loop step",
		Steps: []core.Step{
			{
				ID:     "step1",
				Name:   "Loop Step",
				Action: "loop",
				Parameters: map[string]interface{}{
					"items":    []string{"item1", "item2", "item3"},
					"variable": "item",
				},
				NextStep: "step2",
			},
			{
				ID:     "step2",
				Name:   "Process Item",
				Action: "wait",
				Parameters: map[string]interface{}{
					"duration": "1s",
				},
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store workflow definition
	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Create workflow engine
	engine, err := env.CreateTestWorkflowEngine()
	require.NoError(t, err)

	// Start workflow
	input := map[string]interface{}{
		"test": "data",
	}
	err = engine.StartWorkflow(context.Background(), definition.ID, input)
	require.NoError(t, err)

	// Wait for workflow to complete
	time.Sleep(4 * time.Second)

	// Check workflow status
	status, err := engine.GetWorkflowStatus(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, "COMPLETED", status.Status)
	require.Equal(t, input, status.Input)
	require.NotEmpty(t, status.Output)
	require.NotZero(t, status.StartedAt)
	require.NotZero(t, status.UpdatedAt)
}
