package runtime

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

type integrationTestService struct {
	*BaseService[any]
	name          string
	deps          []string
	connectOrder  *[]string
	orderMutex    *sync.Mutex
	connectCalled bool
	shouldFail    bool
	callCount     int
}

func newIntegrationTestService(name string, deps []string, connectOrder *[]string, orderMutex *sync.Mutex) *integrationTestService {
	return &integrationTestService{
		BaseService:  NewBaseServiceWithDeps[any](name, "test", nil, false, deps),
		name:         name,
		deps:         deps,
		connectOrder: connectOrder,
		orderMutex:   orderMutex,
		shouldFail:   false,
		callCount:    0,
	}
}

func newFailingIntegrationTestService(name string, deps []string, connectOrder *[]string, orderMutex *sync.Mutex) *integrationTestService {
	return &integrationTestService{
		BaseService:  NewBaseServiceWithDeps[any](name, "test", nil, false, deps),
		name:         name,
		deps:         deps,
		connectOrder: connectOrder,
		orderMutex:   orderMutex,
		shouldFail:   true,
		callCount:    0,
	}
}

func (s *integrationTestService) Connect(ctx context.Context, appCtx *ApplicationContext) error {
	s.orderMutex.Lock()
	*s.connectOrder = append(*s.connectOrder, s.name)
	s.orderMutex.Unlock()

	s.connectCalled = true
	s.callCount++

	if s.shouldFail {
		return fmt.Errorf("simulated connection failure for %s", s.name)
	}

	return s.BaseService.Connect(ctx, appCtx)
}

func TestIntegration_ServiceStartupOrder(t *testing.T) {
	connectOrder := []string{}
	orderMutex := &sync.Mutex{}

	app := NewBaseApplication()

	postgres := newIntegrationTestService("postgres", []string{}, &connectOrder, orderMutex)
	nats := newIntegrationTestService("nats", []string{}, &connectOrder, orderMutex)
	workers := newIntegrationTestService("workers", []string{"postgres", "nats"}, &connectOrder, orderMutex)

	if err := app.Register("postgres", postgres); err != nil {
		t.Fatalf("Failed to register postgres: %v", err)
	}
	if err := app.Register("nats", nats); err != nil {
		t.Fatalf("Failed to register nats: %v", err)
	}
	if err := app.Register("workers", workers); err != nil {
		t.Fatalf("Failed to register workers: %v", err)
	}

	rt, err := NewRuntime(&RuntimeConfig{
		Application: app,
		Logger:      &noOpLogger{},
	})
	if err != nil {
		t.Fatalf("Failed to create runtime: %v", err)
	}

	rt.Start()

	time.Sleep(100 * time.Millisecond)

	if !postgres.connectCalled || !nats.connectCalled || !workers.connectCalled {
		t.Error("Not all services were connected")
	}

	if len(connectOrder) != 3 {
		t.Fatalf("Expected 3 services to connect, got %d", len(connectOrder))
	}

	workersIndex := -1
	postgresIndex := -1
	natsIndex := -1

	for i, name := range connectOrder {
		switch name {
		case "workers":
			workersIndex = i
		case "postgres":
			postgresIndex = i
		case "nats":
			natsIndex = i
		}
	}

	if workersIndex < postgresIndex || workersIndex < natsIndex {
		t.Errorf("Workers connected before its dependencies. Order: %v", connectOrder)
	}

	rt.Stop()
}

func TestIntegration_CircularDependencyDetection(t *testing.T) {
	connectOrder := []string{}
	orderMutex := &sync.Mutex{}

	app := NewBaseApplication()

	serviceA := newIntegrationTestService("A", []string{"B"}, &connectOrder, orderMutex)
	serviceB := newIntegrationTestService("B", []string{"A"}, &connectOrder, orderMutex)

	app.Register("A", serviceA)
	err := app.Register("B", serviceB)

	if err == nil {
		t.Fatal("Expected error for circular dependency, got nil")
	}
}

func TestIntegration_MissingDependencyDetection(t *testing.T) {
	connectOrder := []string{}
	orderMutex := &sync.Mutex{}

	app := NewBaseApplication()

	workers := newIntegrationTestService("workers", []string{"postgres", "nats"}, &connectOrder, orderMutex)

	err := app.Register("workers", workers)
	if err == nil {
		t.Fatal("Expected error for missing dependency, got nil")
	}
}

func TestIntegration_ParallelBatchStartup(t *testing.T) {
	connectOrder := []string{}
	orderMutex := &sync.Mutex{}

	app := NewBaseApplication()

	postgres := newIntegrationTestService("postgres", []string{}, &connectOrder, orderMutex)
	nats := newIntegrationTestService("nats", []string{}, &connectOrder, orderMutex)
	badger := newIntegrationTestService("badger", []string{}, &connectOrder, orderMutex)

	if err := app.Register("postgres", postgres); err != nil {
		t.Fatalf("Failed to register postgres: %v", err)
	}
	if err := app.Register("nats", nats); err != nil {
		t.Fatalf("Failed to register nats: %v", err)
	}
	if err := app.Register("badger", badger); err != nil {
		t.Fatalf("Failed to register badger: %v", err)
	}

	batches, err := app.Context().GetServiceBatches()
	if err != nil {
		t.Fatalf("Failed to get service batches: %v", err)
	}

	if len(batches) != 1 {
		t.Errorf("Expected 1 batch for services with no dependencies, got %d", len(batches))
	}

	if len(batches[0]) != 3 {
		t.Errorf("Expected 3 services in first batch, got %d", len(batches[0]))
	}
}

func TestIntegration_ServiceRetryOnlyFailedServices(t *testing.T) {
	connectOrder := []string{}
	orderMutex := &sync.Mutex{}

	app := NewBaseApplication()

	// One service that will succeed, one that will fail
	badger := newIntegrationTestService("badger", []string{}, &connectOrder, orderMutex)
	failingNats := newFailingIntegrationTestService("nats", []string{}, &connectOrder, orderMutex)

	if err := app.Register("badger", badger); err != nil {
		t.Fatalf("Failed to register badger: %v", err)
	}
	if err := app.Register("nats", failingNats); err != nil {
		t.Fatalf("Failed to register nats: %v", err)
	}

	// Mock backoff with reduced times for testing
	originalBackoff := NewBackoff
	NewBackoff = func() *Backoff {
		return &Backoff{
			current: 10 * time.Millisecond,
			min:     10 * time.Millisecond,
			max:     10 * time.Millisecond,
			factor:  1.0,
		} // Faster retry for test
	}
	defer func() { NewBackoff = originalBackoff }()

	rt, err := NewRuntime(&RuntimeConfig{
		Application: app,
		Logger:      &noOpLogger{},
	})
	if err != nil {
		t.Fatalf("Failed to create runtime: %v", err)
	}

	rt.Start()

	// Wait for initial connection attempt + retries
	time.Sleep(100 * time.Millisecond)

	// Badger should only be called once (succeeds immediately)
	if badger.callCount != 1 {
		t.Errorf("Expected badger to be called exactly 1 time, got %d", badger.callCount)
	}

	// Nats should be called multiple times due to retries (failing each time)
	if failingNats.callCount < 2 {
		t.Errorf("Expected failing nats to be called at least 2 times due to retries, got %d", failingNats.callCount)
	}

	rt.Stop()
}
