package testutil

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	gnats "github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	"github.com/wolfymaster/woofx3/wooflow/internal/adapters/nats"
	"github.com/wolfymaster/woofx3/wooflow/internal/adapters/temporal"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/domain"
	"github.com/wolfymaster/woofx3/wooflow/internal/ports"
	"go.temporal.io/sdk/client"
)

// TestEnv represents the test environment
type TestEnv struct {
	T              *testing.T
	DB             *pgxpool.Pool
	NATS           *gnats.Conn
	TemporalClient client.Client
	Logger         *slog.Logger
}

// SetupTestEnv creates a new test environment
func SetupTestEnv(t *testing.T) *TestEnv {
	// Initialize logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	// Connect to PostgreSQL
	dbURL := "postgres://postgres:postgres@localhost:5432/workflow_test?sslmode=disable"
	db, err := pgxpool.New(context.Background(), dbURL)
	require.NoError(t, err)

	// Connect to NATS
	nc, err := gnats.Connect(gnats.DefaultURL)
	require.NoError(t, err)

	// Connect to Temporal
	c, err := client.NewClient(client.Options{
		HostPort: "localhost:7233",
	})
	require.NoError(t, err)

	return &TestEnv{
		T:              t,
		DB:             db,
		NATS:           nc,
		TemporalClient: c,
		Logger:         logger,
	}
}

// Cleanup cleans up the test environment
func (e *TestEnv) Cleanup() {
	if e.DB != nil {
		e.DB.Close()
	}
	if e.NATS != nil {
		e.NATS.Close()
	}
	if e.TemporalClient != nil {
		e.TemporalClient.Close()
	}
}

// CreateTestConsumer creates a test NATS consumer
func (e *TestEnv) CreateTestConsumer(subjects []string) (*nats.Consumer, error) {
	// Create in-memory repositories
	eventRepo := domain.NewMemoryEventRepository()
	workflowRepo := domain.NewMemoryWorkflowDefinitionRepository()

	// Create NATS consumer
	consumer := nats.NewConsumer(e.NATS, eventRepo, workflowRepo, e.Logger, nil)
	return consumer, nil
}

// CreateTestWorkflowEngine creates a test workflow engine instance
func (e *TestEnv) CreateTestWorkflowEngine() (ports.WorkflowEngine, error) {
	// Create in-memory workflow definition repository
	workflowRepo := domain.NewMemoryWorkflowDefinitionRepository()

	// Create Temporal workflow engine
	engine, err := temporal.NewEngine(
		"localhost:7233",
		"default",
		"workflow_test",
		workflowRepo,
		e.Logger,
	)
	if err != nil {
		return nil, err
	}

	return engine, nil
}

// PublishTestEvent publishes a test event to NATS
func (e *TestEnv) PublishTestEvent(subject string, event core.Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	return e.NATS.Publish(subject, data)
}

// WaitForEvent waits for an event to be processed
func (e *TestEnv) WaitForEvent(ctx context.Context, eventID string, timeout time.Duration) (*core.Event, error) {
	// Create in-memory event repository
	eventRepo := domain.NewMemoryEventRepository()

	// Wait for event to be stored
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		event, err := eventRepo.GetEventByID(ctx, eventID)
		if err == nil && event != nil {
			return event, nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return nil, fmt.Errorf("event %s not found after %v", eventID, timeout)
}
