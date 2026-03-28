package engine

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/core/engine/local"
	"github.com/wolfymaster/woofx3/wooflow/internal/core/engine/temporal"
)

// NewWorkflowEngine creates a new workflow engine based on configuration
func NewWorkflowEngine(ctx context.Context, config core.WorkflowEngineConfig, nc *nats.Conn) (core.WorkflowEngine, error) {
	switch api.Backend(config.Engine) {
	case api.BackendTemporal:
		return newTemporalEngine(ctx, config, nc)
	case api.BackendLocal:
		return newLocalEngine(ctx, config, nc)
	default:
		return newLocalEngine(ctx, config, nc) // Default to local
	}
}

// newTemporalEngine creates a new Temporal-based workflow engine
func newTemporalEngine(ctx context.Context, config core.WorkflowEngineConfig, nc *nats.Conn) (core.WorkflowEngine, error) {
	client, err := temporal.NewClient(
		config.Temporal.Host,
		config.Temporal.Namespace,
		config.TaskQueue,
		config.EventRepo,
		config.WorkflowRepo,
		nc,
		config.Logger,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create Temporal client: %w", err)
	}

	return &TemporalEngineAdapter{
		client:    client,
		isHealthy: false, // Will be set to true in Start()
		started:   false,
	}, nil
}

// newLocalEngine creates a new local workflow engine
func newLocalEngine(ctx context.Context, config core.WorkflowEngineConfig, nc *nats.Conn) (core.WorkflowEngine, error) {
	engine, err := local.NewEngine(local.Config{
		MaxConcurrentWorkflows: config.Local.MaxConcurrentWorkflows,
		WorkflowTimeout:        config.Local.WorkflowTimeout,
		TaskQueue:              config.TaskQueue,
		Logger:                 config.Logger,
		EventRepo:              config.EventRepo,
		WorkflowRepo:           config.WorkflowRepo,
		NatsConn:               nc,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create local engine: %w", err)
	}

	return engine, nil
}

// FromEnv creates a workflow engine from environment variables
func FromEnv(ctx context.Context, eventRepo core.EventRepository, workflowRepo core.WorkflowDefinitionRepository, nc *nats.Conn, logger log.Logger) (core.WorkflowEngine, error) {
	config := core.WorkflowEngineConfig{
		Engine:       getEnvWithDefault("WORKFLOW_ENGINE", "local"),
		TaskQueue:    getEnvWithDefault("WORKFLOW_TASK_QUEUE", "workflow"),
		Logger:       logger,
		EventRepo:    eventRepo,
		WorkflowRepo: workflowRepo,
		Temporal: core.TemporalConfig{
			Host:      getEnvWithDefault("TEMPORAL_HOST", "localhost:7233"),
			Namespace: getEnvWithDefault("TEMPORAL_NAMESPACE", "default"),
		},
		Local: core.LocalConfig{
			MaxConcurrentWorkflows: getEnvIntWithDefault("WORKFLOW_MAX_CONCURRENT", 10),
			WorkflowTimeout:        getEnvIntWithDefault("WORKFLOW_TIMEOUT", 300), // 5 minutes
		},
	}

	// Auto-detect engine based on Temporal availability
	if config.Engine == "local" {
		if logger != nil {
			logger.Info("Using local workflow engine")
		}
	} else {
		if logger != nil {
			logger.Info("Using Temporal workflow engine", "host", config.Temporal.Host)
		}
	}

	return NewWorkflowEngine(ctx, config, nc)
}

func getEnvWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvIntWithDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var intValue int
		if _, err := fmt.Sscanf(value, "%d", &intValue); err == nil {
			return intValue
		}
	}
	return defaultValue
}
