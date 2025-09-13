package messagebus

import (
        "encoding/json"
        "fmt"
        "log/slog"
        "os"
        "strings"
        "time"

        "github.com/nats-io/nats.go"
)

// Example showing how to migrate wooflow to use the Bus interface
// This demonstrates the compatibility with existing NATS usage patterns

// ExampleApp shows how the wooflow app can be refactored to use Bus
type ExampleApp struct {
        Logger        *slog.Logger
        bus           Bus
        subscriptions []Subscription
}

// ExampleEvent represents a workflow event (simplified version)
type ExampleEvent struct {
        ID   string `json:"id"`
        Type string `json:"type"`
        Data string `json:"data"`
}

// NewExampleApp creates a new app instance using the message bus
func NewExampleApp() (*ExampleApp, error) {
        logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

        // Use FromEnv to automatically detect NATS vs memory backend
        bus, err := FromEnv(logger)
        if err != nil {
                return nil, fmt.Errorf("failed to create message bus: %w", err)
        }

        return &ExampleApp{
                Logger: logger,
                bus:    bus,
        }, nil
}

// SetupSubscription sets up NATS subscription (compatible with original wooflow pattern)
func (app *ExampleApp) SetupSubscription() error {
        // This handler function signature is identical to the original NATS callback
        messageHandler := func(msg *nats.Msg) {
                app.handleMessage(msg)
        }

        // Subscribe using the same pattern as the original code
        sub, err := app.bus.Subscribe("workflow.>", messageHandler)
        if err != nil {
                app.Logger.Error("failed to subscribe to workflow events", "error", err)
                return fmt.Errorf("failed to subscribe to workflow events: %w", err)
        }

        app.subscriptions = append(app.subscriptions, sub)
        app.Logger.Info("subscribed to workflow events")

        return nil
}

// handleMessage handles incoming workflow messages (compatible with original wooflow pattern)
func (app *ExampleApp) handleMessage(msg *nats.Msg) {
        // Extract event type from subject (same as original code)
        eventType := strings.TrimPrefix(msg.Subject, "workflow.")

        app.Logger.Info("handling event", "eventType", eventType, "subject", msg.Subject)

        // Parse event payload (same as original code)
        var event ExampleEvent
        if err := json.Unmarshal(msg.Data, &event); err != nil {
                app.Logger.Error("failed to parse event payload", "error", err)
                return
        }

        if event.ID == "" {
                event.ID = fmt.Sprintf("%d", time.Now().UnixNano())
        }

        // Process the event
        app.Logger.Info("processed event", "id", event.ID, "type", event.Type)
}

// PublishEvent publishes an event to the message bus
func (app *ExampleApp) PublishEvent(eventType string, event ExampleEvent) error {
        data, err := json.Marshal(event)
        if err != nil {
                return fmt.Errorf("failed to marshal event: %w", err)
        }

        subject := "workflow." + eventType
        return app.bus.Publish(subject, data)
}

// GetNATSConnection returns the underlying NATS connection if available
// This is useful for integrating with existing code that needs *nats.Conn
func (app *ExampleApp) GetNATSConnection() (*nats.Conn, bool) {
        return app.bus.AsNATS()
}

// Close cleans up resources (compatible with original wooflow cleanup pattern)
func (app *ExampleApp) Close() {
        // Unsubscribe from all subscriptions (same pattern as original)
        for _, sub := range app.subscriptions {
                sub.Unsubscribe()
        }

        // Close the bus connection
        app.bus.Close()

        app.Logger.Info("app closed")
}

// ExampleUsage shows how to use the message bus in a way that's compatible with existing wooflow patterns
func ExampleUsage() error {
        // Create app (replaces the original NewApp function)
        app, err := NewExampleApp()
        if err != nil {
                return fmt.Errorf("failed to create app: %w", err)
        }
        defer app.Close()

        // Set up subscription (same as original setupNATSSubscription)
        if err := app.SetupSubscription(); err != nil {
                return fmt.Errorf("failed to setup subscription: %w", err)
        }

        // Publish some test events
        events := []ExampleEvent{
                {ID: "1", Type: "started", Data: "workflow started"},
                {ID: "2", Type: "completed", Data: "workflow completed"},
                {ID: "3", Type: "failed", Data: "workflow failed"},
        }

        for _, event := range events {
                if err := app.PublishEvent(event.Type, event); err != nil {
                        app.Logger.Error("failed to publish event", "error", err, "event", event)
                }
        }

        // Give time for message processing
        time.Sleep(100 * time.Millisecond)

        // If you need the underlying NATS connection (for legacy code)
        if natsConn, ok := app.GetNATSConnection(); ok {
                app.Logger.Info("using NATS backend", "connected", natsConn.IsConnected())
        } else {
                app.Logger.Info("using memory backend")
        }

        return nil
}