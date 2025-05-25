package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"

	_ "github.com/mattn/go-sqlite3"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
)

// EventRepository implements core.EventRepository using SQLite
type EventRepository struct {
	db   *sql.DB
	mu   sync.RWMutex
	once sync.Once
}

// NewEventRepository creates a new SQLite-based event repository
func NewEventRepository() *EventRepository {
	return &EventRepository{}
}

// initDB initializes the SQLite database
func (r *EventRepository) initDB() error {
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

		// Create events table
		_, err = r.db.Exec(`
			CREATE TABLE IF NOT EXISTS events (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				payload TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`)
	})
	return err
}

// StoreEvent stores a new event
func (r *EventRepository) StoreEvent(ctx context.Context, event *core.Event) error {
	if err := r.initDB(); err != nil {
		return fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	payloadJSON, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO events (id, type, payload)
		VALUES (?, ?, ?)
	`, event.ID, event.Type, payloadJSON)

	if err != nil {
		return fmt.Errorf("failed to store event: %w", err)
	}

	return nil
}

// GetEvent retrieves an event by ID
func (r *EventRepository) GetEvent(ctx context.Context, id string) (*core.Event, error) {
	if err := r.initDB(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var event core.Event
	var payloadJSON string

	err := r.db.QueryRowContext(ctx, `
		SELECT id, type, payload
		FROM events
		WHERE id = ?
	`, id).Scan(&event.ID, &event.Type, &payloadJSON)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("event not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get event: %w", err)
	}

	if err := json.Unmarshal([]byte(payloadJSON), &event.Payload); err != nil {
		return nil, fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	return &event, nil
}

// GetEventByID retrieves an event by ID (alias for GetEvent to maintain compatibility)
func (r *EventRepository) GetEventByID(ctx context.Context, id string) (*core.Event, error) {
	return r.GetEvent(ctx, id)
}

// QueryEvents lists events based on filter
func (r *EventRepository) QueryEvents(ctx context.Context, filter *core.EventFilter) ([]*core.Event, error) {
	if err := r.initDB(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	query := `
		SELECT id, type, payload
		FROM events
		WHERE 1=1
	`
	args := []interface{}{}

	if filter != nil {
		if filter.Type != "" {
			query += " AND type = ?"
			args = append(args, filter.Type)
		}
	}

	// Add order by created_at desc
	query += " ORDER BY created_at DESC"

	// Add limit if specified
	if filter != nil && filter.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query events: %w", err)
	}
	defer rows.Close()

	var events []*core.Event
	for rows.Next() {
		var event core.Event
		var payloadJSON string

		err := rows.Scan(&event.ID, &event.Type, &payloadJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event: %w", err)
		}

		if err := json.Unmarshal([]byte(payloadJSON), &event.Payload); err != nil {
			return nil, fmt.Errorf("failed to unmarshal payload: %w", err)
		}

		events = append(events, &event)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating events: %w", err)
	}

	return events, nil
}
