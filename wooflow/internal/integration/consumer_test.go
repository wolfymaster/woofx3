package integration

import (
	"context"
	"testing"
	"time"

	gnats "github.com/nats-io/nats.go"
	"github.com/stretchr/testify/require"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/testutil"
)

func TestConsumer_HandleEvent(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create test consumer
	consumer, err := env.CreateTestConsumer([]string{"workflow.test"})
	require.NoError(t, err)
	defer consumer.Close()

	// Start consumer in background
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		err := consumer.Start(ctx)
		require.NoError(t, err)
	}()

	// Create test event
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

	// Publish event
	err = env.PublishTestEvent("workflow.test", event)
	require.NoError(t, err)

	// Wait for event to be processed
	processedEvent, err := env.WaitForEvent(ctx, event.ID, 5*time.Second)
	require.NoError(t, err)
	require.NotNil(t, processedEvent)
	require.Equal(t, event.ID, processedEvent.ID)
	require.Equal(t, event.Type, processedEvent.Type)
}

func TestConsumer_InvalidEvent(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create test consumer
	consumer, err := env.CreateTestConsumer([]string{"workflow.test"})
	require.NoError(t, err)
	defer consumer.Close()

	// Start consumer in background
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		err := consumer.Start(ctx)
		require.NoError(t, err)
	}()

	// Create invalid event
	event := core.Event{
		ID:   "test-event-2",
		Type: "bits",
		Data: map[string]interface{}{
			"type":     "bits",
			"amount":   -100, // Invalid amount
			"username": "testuser",
		},
		CreatedAt: time.Now(),
	}

	// Publish event
	err = env.PublishTestEvent("workflow.test", event)
	require.NoError(t, err)

	// Wait for event to be processed (should not be stored)
	_, err = env.WaitForEvent(ctx, event.ID, 5*time.Second)
	require.Error(t, err) // Should timeout waiting for event
}

func TestConsumer_Reconnection(t *testing.T) {
	env := testutil.SetupTestEnv(t)
	defer env.Cleanup()

	// Create test consumer
	consumer, err := env.CreateTestConsumer([]string{"workflow.test"})
	require.NoError(t, err)
	defer consumer.Close()

	// Start consumer in background
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		err := consumer.Start(ctx)
		require.NoError(t, err)
	}()

	// Create test event
	event := core.Event{
		ID:   "test-event-3",
		Type: "bits",
		Data: map[string]interface{}{
			"type":      "bits",
			"amount":    100,
			"username":  "testuser",
			"timestamp": "2024-01-20T12:00:00Z",
		},
		CreatedAt: time.Now(),
	}

	// Disconnect NATS
	env.NATS.Close()

	// Wait a bit
	time.Sleep(2 * time.Second)

	// Reconnect NATS
	nc, err := gnats.Connect(gnats.DefaultURL)
	require.NoError(t, err)
	env.NATS = nc

	// Publish event
	err = env.PublishTestEvent("workflow.test", event)
	require.NoError(t, err)

	// Wait for event to be processed
	processedEvent, err := env.WaitForEvent(ctx, event.ID, 5*time.Second)
	require.NoError(t, err)
	require.NotNil(t, processedEvent)
	require.Equal(t, event.ID, processedEvent.ID)
}
