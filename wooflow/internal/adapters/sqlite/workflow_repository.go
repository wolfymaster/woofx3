package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"

	_ "github.com/mattn/go-sqlite3"
	"github.com/wolfymaster/woofx3/workflow/internal/core"
)

// WorkflowDefinitionRepository implements core.WorkflowDefinitionRepository using SQLite
type WorkflowDefinitionRepository struct {
	db   *sql.DB
	mu   sync.RWMutex
	once sync.Once
}

// NewWorkflowDefinitionRepository creates a new SQLite-based workflow repository
func NewWorkflowDefinitionRepository() *WorkflowDefinitionRepository {
	return &WorkflowDefinitionRepository{}
}

// initDB initializes the SQLite database
func (r *WorkflowDefinitionRepository) initDB() error {
	var err error
	r.once.Do(func() {
		// Use a file-based database instead of in-memory
		r.db, err = sql.Open("sqlite3", "workflow.db")
		if err != nil {
			return
		}

		// Enable foreign keys
		_, err = r.db.Exec("PRAGMA foreign_keys = ON")
		if err != nil {
			return
		}

		// Create workflow_definitions table
		_, err = r.db.Exec(`
			CREATE TABLE IF NOT EXISTS workflow_definitions (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				steps TEXT NOT NULL,
				trigger TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`)
	})
	return err
}

// CreateWorkflowDefinition creates a new workflow definition
func (r *WorkflowDefinitionRepository) CreateWorkflowDefinition(ctx context.Context, def *core.WorkflowDefinition) error {
	if err := r.initDB(); err != nil {
		return fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	stepsJSON, err := json.Marshal(def.Steps)
	if err != nil {
		return fmt.Errorf("failed to marshal steps: %w", err)
	}

	var triggerJSON []byte
	if def.Trigger != nil {
		triggerJSON, err = json.Marshal(def.Trigger)
		if err != nil {
			return fmt.Errorf("failed to marshal trigger: %w", err)
		}
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO workflow_definitions (id, name, steps, trigger)
		VALUES (?, ?, ?, ?)
	`, def.ID, def.Name, stepsJSON, triggerJSON)

	if err != nil {
		return fmt.Errorf("failed to create workflow definition: %w", err)
	}

	return nil
}

// GetWorkflowDefinitionByID retrieves a workflow definition by ID
func (r *WorkflowDefinitionRepository) GetWorkflowDefinitionByID(ctx context.Context, id string) (*core.WorkflowDefinition, error) {
	if err := r.initDB(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var def core.WorkflowDefinition
	var stepsJSON, triggerJSON string

	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, steps, trigger
		FROM workflow_definitions
		WHERE id = ?
	`, id).Scan(&def.ID, &def.Name, &stepsJSON, &triggerJSON)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("workflow definition not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get workflow definition: %w", err)
	}

	if err := json.Unmarshal([]byte(stepsJSON), &def.Steps); err != nil {
		return nil, fmt.Errorf("failed to unmarshal steps: %w", err)
	}

	if triggerJSON != "" {
		if err := json.Unmarshal([]byte(triggerJSON), &def.Trigger); err != nil {
			return nil, fmt.Errorf("failed to unmarshal trigger: %w", err)
		}
	}

	return &def, nil
}

// UpdateWorkflowDefinition updates an existing workflow definition
func (r *WorkflowDefinitionRepository) UpdateWorkflowDefinition(ctx context.Context, def *core.WorkflowDefinition) error {
	if err := r.initDB(); err != nil {
		return fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	stepsJSON, err := json.Marshal(def.Steps)
	if err != nil {
		return fmt.Errorf("failed to marshal steps: %w", err)
	}

	var triggerJSON []byte
	if def.Trigger != nil {
		triggerJSON, err = json.Marshal(def.Trigger)
		if err != nil {
			return fmt.Errorf("failed to marshal trigger: %w", err)
		}
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE workflow_definitions
		SET name = ?, steps = ?, trigger = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, def.Name, stepsJSON, triggerJSON, def.ID)

	if err != nil {
		return fmt.Errorf("failed to update workflow definition: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("workflow definition not found")
	}

	return nil
}

// DeleteWorkflowDefinition deletes a workflow definition
func (r *WorkflowDefinitionRepository) DeleteWorkflowDefinition(ctx context.Context, id string) error {
	if err := r.initDB(); err != nil {
		return fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	result, err := r.db.ExecContext(ctx, `
		DELETE FROM workflow_definitions
		WHERE id = ?
	`, id)

	if err != nil {
		return fmt.Errorf("failed to delete workflow definition: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return fmt.Errorf("workflow definition not found")
	}

	return nil
}

// QueryWorkflowDefinitions lists workflow definitions based on filter
func (r *WorkflowDefinitionRepository) QueryWorkflowDefinitions(ctx context.Context, filter *core.WorkflowDefinitionFilter) ([]*core.WorkflowDefinition, error) {
	if err := r.initDB(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	query := `
		SELECT id, name, steps, trigger
		FROM workflow_definitions
		WHERE 1=1
	`
	args := []interface{}{}

	if filter != nil {
		if filter.Name != "" {
			query += " AND name LIKE ?"
			args = append(args, "%"+filter.Name+"%")
		}
		if filter.TriggerEvent != "" {
			query += " AND trigger LIKE ?"
			args = append(args, "%"+filter.TriggerEvent+"%")
		}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query workflow definitions: %w", err)
	}
	defer rows.Close()

	var defs []*core.WorkflowDefinition
	for rows.Next() {
		var def core.WorkflowDefinition
		var stepsJSON, triggerJSON string

		err := rows.Scan(&def.ID, &def.Name, &stepsJSON, &triggerJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to scan workflow definition: %w", err)
		}

		if err := json.Unmarshal([]byte(stepsJSON), &def.Steps); err != nil {
			return nil, fmt.Errorf("failed to unmarshal steps: %w", err)
		}

		if triggerJSON != "" {
			if err := json.Unmarshal([]byte(triggerJSON), &def.Trigger); err != nil {
				return nil, fmt.Errorf("failed to unmarshal trigger: %w", err)
			}
		}

		defs = append(defs, &def)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating workflow definitions: %w", err)
	}

	return defs, nil
}
