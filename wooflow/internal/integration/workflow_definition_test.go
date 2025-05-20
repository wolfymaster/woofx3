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

func TestWorkflowDefinitionRepository(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	repo := postgres.NewPostgresWorkflowDefinitionRepository(env.DB)

	// Create test workflow definition
	definition := core.WorkflowDefinition{
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
			},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Test CreateWorkflowDefinition
	err := repo.CreateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Test GetWorkflowDefinitionByID
	retrieved, err := repo.GetWorkflowDefinitionByID(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, definition.ID, retrieved.ID)
	require.Equal(t, definition.Name, retrieved.Name)
	require.Equal(t, definition.Description, retrieved.Description)
	require.Equal(t, definition.Steps[0].ID, retrieved.Steps[0].ID)
	require.Equal(t, definition.Steps[0].Name, retrieved.Steps[0].Name)
	require.Equal(t, definition.Steps[0].Action, retrieved.Steps[0].Action)
	require.Equal(t, definition.Steps[0].Parameters, retrieved.Steps[0].Parameters)

	// Test QueryWorkflowDefinitions
	definitions, err := repo.QueryWorkflowDefinitions(context.Background(), core.WorkflowDefinitionFilter{
		Name: definition.Name,
	})
	require.NoError(t, err)
	require.Len(t, definitions, 1)
	require.Equal(t, definition.ID, definitions[0].ID)

	// Test UpdateWorkflowDefinition
	definition.Name = "Updated Workflow"
	definition.Description = "Updated description"
	err = repo.UpdateWorkflowDefinition(context.Background(), definition)
	require.NoError(t, err)

	// Verify update
	updated, err := repo.GetWorkflowDefinitionByID(context.Background(), definition.ID)
	require.NoError(t, err)
	require.Equal(t, definition.Name, updated.Name)
	require.Equal(t, definition.Description, updated.Description)

	// Test DeleteWorkflowDefinition
	err = repo.DeleteWorkflowDefinition(context.Background(), definition.ID)
	require.NoError(t, err)

	// Verify deletion
	_, err = repo.GetWorkflowDefinitionByID(context.Background(), definition.ID)
	require.Error(t, err)
}
