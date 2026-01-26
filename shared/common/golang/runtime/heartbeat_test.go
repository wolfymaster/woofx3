package runtime

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	natsclient "github.com/wolfymaster/woofx3/clients/nats"
)

// mockNATSClient is a mock implementation of NATSClient for testing
type mockNATSClient struct {
	publishedMessages []publishedMessage
	subscriptions     map[string][]natsclient.Handler
}

type publishedMessage struct {
	subject string
	data    []byte
}

func newMockNATSClient() *mockNATSClient {
	return &mockNATSClient{
		publishedMessages: make([]publishedMessage, 0),
		subscriptions:     make(map[string][]natsclient.Handler),
	}
}

func (m *mockNATSClient) Publish(subject string, data []byte) error {
	m.publishedMessages = append(m.publishedMessages, publishedMessage{
		subject: subject,
		data:    data,
	})
	return nil
}

func (m *mockNATSClient) Subscribe(subject string, handler natsclient.Handler) (natsclient.Subscription, error) {
	if m.subscriptions[subject] == nil {
		m.subscriptions[subject] = make([]natsclient.Handler, 0)
	}
	m.subscriptions[subject] = append(m.subscriptions[subject], handler)
	return nil, nil
}

func (m *mockNATSClient) getPublishedMessages() []publishedMessage {
	return m.publishedMessages
}

func (m *mockNATSClient) triggerSubscription(subject string, msg natsclient.Msg) {
	if handlers, ok := m.subscriptions[subject]; ok {
		for _, handler := range handlers {
			handler(msg)
		}
	}
}

// mockMsg is a simple implementation of natsclient.Msg for testing
type mockMsg struct {
	subject string
	data    []byte
}

func (m *mockMsg) Subject() string {
	return m.subject
}

func (m *mockMsg) Data() []byte {
	return m.data
}

func (m *mockMsg) String() string {
	return string(m.data)
}

func (m *mockMsg) JSON(v interface{}) error {
	return json.Unmarshal(m.data, v)
}

func TestCreateNATSHeartbeat(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockNATSClient()
	appName := "test-app"
	subject := "TEST_HEARTBEAT"

	// Test with ready = true
	readyFn := func() bool { return true }
	heartbeatFunc := CreateNATSHeartbeat(mockClient, appName, subject, readyFn)

	err := heartbeatFunc(ctx)
	if err != nil {
		t.Fatalf("Expected no error from heartbeat, got: %v", err)
	}

	// Verify message was published
	messages := mockClient.getPublishedMessages()
	if len(messages) != 1 {
		t.Fatalf("Expected 1 published message, got %d", len(messages))
	}

	msg := messages[0]
	if msg.subject != subject {
		t.Errorf("Expected subject %q, got %q", subject, msg.subject)
	}

	// Verify the published message is valid JSON
	var eventMap map[string]interface{}
	if err := json.Unmarshal(msg.data, &eventMap); err != nil {
		t.Fatalf("Failed to unmarshal published message: %v", err)
	}

	// Verify CloudEvent structure
	if eventMap["type"] != "com.woofx3.heartbeat" {
		t.Errorf("Expected type %q, got %v", "com.woofx3.heartbeat", eventMap["type"])
	}

	if eventMap["source"] != appName {
		t.Errorf("Expected source %q, got %v", appName, eventMap["source"])
	}

	if eventMap["subject"] != "HEARTBEAT" {
		t.Errorf("Expected subject %q, got %v", "HEARTBEAT", eventMap["subject"])
	}

	// Verify data field
	data, ok := eventMap["data"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected data field to be an object")
	}

	if data["application"] != appName {
		t.Errorf("Expected data.application %q, got %v", appName, data["application"])
	}

	if data["ready"] != true {
		t.Errorf("Expected data.ready to be true, got %v", data["ready"])
	}
}

func TestCreateNATSHeartbeat_WithoutReadyFn(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockNATSClient()
	appName := "test-app-2"

	// Test without readyFn (should default to ready = true)
	heartbeatFunc := CreateNATSHeartbeat(mockClient, appName, "", nil)

	err := heartbeatFunc(ctx)
	if err != nil {
		t.Fatalf("Expected no error from heartbeat, got: %v", err)
	}

	// Verify message was published with default subject
	messages := mockClient.getPublishedMessages()
	if len(messages) != 1 {
		t.Fatalf("Expected 1 published message, got %d", len(messages))
	}

	msg := messages[0]
	if msg.subject != "HEARTBEAT" {
		t.Errorf("Expected default subject %q, got %q", "HEARTBEAT", msg.subject)
	}

	// Verify ready is true
	var eventMap map[string]interface{}
	json.Unmarshal(msg.data, &eventMap)
	data := eventMap["data"].(map[string]interface{})
	if data["ready"] != true {
		t.Errorf("Expected data.ready to be true by default, got %v", data["ready"])
	}
}

func TestCreateNATSHeartbeat_WithReadyFalse(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockNATSClient()
	appName := "test-app-3"

	// Test with ready = false
	readyFn := func() bool { return false }
	heartbeatFunc := CreateNATSHeartbeat(mockClient, appName, "", readyFn)

	err := heartbeatFunc(ctx)
	if err != nil {
		t.Fatalf("Expected no error from heartbeat, got: %v", err)
	}

	messages := mockClient.getPublishedMessages()
	if len(messages) != 1 {
		t.Fatalf("Expected 1 published message, got %d", len(messages))
	}

	// Verify ready is false
	var eventMap map[string]interface{}
	json.Unmarshal(messages[0].data, &eventMap)
	data := eventMap["data"].(map[string]interface{})
	if data["ready"] != false {
		t.Errorf("Expected data.ready to be false, got %v", data["ready"])
	}
}

func TestCreateNATSHealthCheck(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockNATSClient()
	subject := "TEST_HEALTH_CHECK"

	// Create a mock services registry
	services := ServicesRegistry{
		"service1": &mockService{name: "service1", healthcheck: true},
		"service2": &mockService{name: "service2", healthcheck: true},
	}

	healthCheckFunc := CreateNATSHealthCheck(mockClient, subject)

	// Initially, services should not be ready
	ready, err := healthCheckFunc(ctx, services)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if ready {
		t.Error("Expected health check to return false initially (no heartbeats received)")
	}

	// Simulate receiving heartbeat for service1
	heartbeatData := map[string]interface{}{
		"specversion": "1.0",
		"type":        "com.woofx3.heartbeat",
		"source":      "service1",
		"subject":     "HEARTBEAT",
		"data": map[string]interface{}{
			"application": "service1",
			"ready":       true,
		},
	}
	heartbeatBytes, _ := json.Marshal(heartbeatData)
	service1Msg := &mockMsg{
		subject: subject,
		data:    heartbeatBytes,
	}

	// Trigger subscription handlers manually
	mockClient.triggerSubscription(subject, service1Msg)

	// Give a small delay for goroutines if any
	time.Sleep(10 * time.Millisecond)

	// Still should be false (service2 not ready)
	ready, err = healthCheckFunc(ctx, services)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if ready {
		t.Error("Expected health check to return false (service2 not ready)")
	}

	// Simulate receiving heartbeat for service2
	heartbeatData2 := map[string]interface{}{
		"specversion": "1.0",
		"type":        "com.woofx3.heartbeat",
		"source":      "service2",
		"subject":     "HEARTBEAT",
		"data": map[string]interface{}{
			"application": "service2",
			"ready":       true,
		},
	}
	heartbeatBytes2, _ := json.Marshal(heartbeatData2)
	mockMsg2 := &mockMsg{
		subject: subject,
		data:    heartbeatBytes2,
	}
	mockClient.triggerSubscription(subject, mockMsg2)

	time.Sleep(10 * time.Millisecond)

	// Now both services should be ready
	ready, err = healthCheckFunc(ctx, services)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if !ready {
		t.Error("Expected health check to return true (both services ready)")
	}
}

func TestCreateNATSHealthCheck_WithNonHealthcheckService(t *testing.T) {
	ctx := context.Background()
	mockClient := newMockNATSClient()

	// Create services where one doesn't need healthcheck
	services := ServicesRegistry{
		"service1": &mockService{name: "service1", healthcheck: true},
		"service2": &mockService{name: "service2", healthcheck: false}, // Doesn't need healthcheck
	}

	healthCheckFunc := CreateNATSHealthCheck(mockClient, "")

	// Initially should be false
	ready, err := healthCheckFunc(ctx, services)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if ready {
		t.Error("Expected health check to return false initially")
	}

	// Simulate receiving heartbeat only for service1 (the one that needs healthcheck)
	heartbeatData := map[string]interface{}{
		"specversion": "1.0",
		"type":        "com.woofx3.heartbeat",
		"source":      "service1",
		"data": map[string]interface{}{
			"application": "service1",
			"ready":       true,
		},
	}
	heartbeatBytes, _ := json.Marshal(heartbeatData)
	mockMsg := &mockMsg{
		subject: "HEARTBEAT",
		data:    heartbeatBytes,
	}
	mockClient.triggerSubscription("HEARTBEAT", mockMsg)

	time.Sleep(10 * time.Millisecond)

	// Should be true now (only service1 needs healthcheck and it's ready)
	ready, err = healthCheckFunc(ctx, services)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if !ready {
		t.Error("Expected health check to return true (service1 ready, service2 doesn't need healthcheck)")
	}
}

// mockService implements the Service interface for testing
type mockService struct {
	name        string
	healthcheck bool
}

func (m *mockService) Name() string {
	return m.name
}

func (m *mockService) Type() string {
	return m.name
}

func (m *mockService) Healthcheck() bool {
	return m.healthcheck
}

func (m *mockService) Connect(ctx context.Context, appCtx *ApplicationContext) error {
	return nil
}

func (m *mockService) Disconnect(ctx context.Context) error {
	return nil
}

func (m *mockService) Connected() bool {
	return true
}

func (m *mockService) Client() any {
	return nil
}

func (m *mockService) Dependencies() []string {
	return []string{}
}
