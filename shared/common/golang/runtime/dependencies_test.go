package runtime

import (
	"context"
	"testing"
)

type mockDependencyService struct {
	*BaseService[any]
	connectCalled    bool
	disconnectCalled bool
}

func newMockDependencyService(name string, deps []string) *mockDependencyService {
	return &mockDependencyService{
		BaseService: NewBaseServiceWithDeps[any](name, "mock", nil, false, deps),
	}
}

func (m *mockDependencyService) Connect(ctx context.Context, appCtx *ApplicationContext) error {
	m.connectCalled = true
	return m.BaseService.Connect(ctx, appCtx)
}

func (m *mockDependencyService) Disconnect(ctx context.Context) error {
	m.disconnectCalled = true
	return m.BaseService.Disconnect(ctx)
}

func TestGetServiceBatches_NoDependencies(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{})
	svcB := newMockDependencyService("B", []string{})
	svcC := newMockDependencyService("C", []string{})

	graph.AddService("A", svcA)
	graph.AddService("B", svcB)
	graph.AddService("C", svcC)

	batches, err := graph.GetServiceBatches()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(batches) != 1 {
		t.Fatalf("Expected 1 batch, got %d", len(batches))
	}

	if len(batches[0]) != 3 {
		t.Fatalf("Expected 3 services in batch, got %d", len(batches[0]))
	}
}

func TestGetServiceBatches_SimpleChain(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{})
	svcB := newMockDependencyService("B", []string{"A"})
	svcC := newMockDependencyService("C", []string{"B"})

	graph.AddService("A", svcA)
	graph.AddService("B", svcB)
	graph.AddService("C", svcC)

	batches, err := graph.GetServiceBatches()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(batches) != 3 {
		t.Fatalf("Expected 3 batches, got %d", len(batches))
	}

	if svc, ok := batches[0][0].(interface{ Name() string }); !ok || svc.Name() != "A" {
		t.Errorf("Expected A first")
	}
	if svc, ok := batches[1][0].(interface{ Name() string }); !ok || svc.Name() != "B" {
		t.Errorf("Expected B second")
	}
	if svc, ok := batches[2][0].(interface{ Name() string }); !ok || svc.Name() != "C" {
		t.Errorf("Expected C third")
	}
}

func TestGetServiceBatches_Diamond(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{})
	svcB := newMockDependencyService("B", []string{"A"})
	svcC := newMockDependencyService("C", []string{"A"})
	svcD := newMockDependencyService("D", []string{"B", "C"})

	graph.AddService("A", svcA)
	graph.AddService("B", svcB)
	graph.AddService("C", svcC)
	graph.AddService("D", svcD)

	batches, err := graph.GetServiceBatches()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(batches) != 3 {
		t.Fatalf("Expected 3 batches, got %d", len(batches))
	}

	if len(batches[0]) != 1 {
		t.Error("Expected 1 service in first batch")
	} else if svc, ok := batches[0][0].(interface{ Name() string }); !ok || svc.Name() != "A" {
		t.Error("Expected A in first batch alone")
	}

	if len(batches[1]) != 2 {
		t.Errorf("Expected 2 services in second batch, got %d", len(batches[1]))
	}

	if len(batches[2]) != 1 {
		t.Error("Expected 1 service in third batch")
	} else if svc, ok := batches[2][0].(interface{ Name() string }); !ok || svc.Name() != "D" {
		t.Error("Expected D in third batch alone")
	}
}

func TestCircularDependency_Detection(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{"B"})
	svcB := newMockDependencyService("B", []string{"C"})
	svcC := newMockDependencyService("C", []string{"A"})

	graph.AddService("A", svcA)
	graph.AddService("B", svcB)
	graph.AddService("C", svcC)

	err := graph.Validate()
	if err == nil {
		t.Fatal("Expected error for circular dependency")
	}
}

func TestMissingDependency_Detection(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{"B"})
	graph.AddService("A", svcA)

	err := graph.Validate()
	if err == nil {
		t.Fatal("Expected error for missing dependency")
	}
}

func TestDBServiceDependencies(t *testing.T) {
	graph := NewDependencyGraph()

	postgres := newMockDependencyService("postgres", []string{})
	badger := newMockDependencyService("badger", []string{})
	nats := newMockDependencyService("nats", []string{})
	workers := newMockDependencyService("workers", []string{"postgres", "nats"})
	http := newMockDependencyService("http", []string{})

	graph.AddService("postgres", postgres)
	graph.AddService("badger", badger)
	graph.AddService("nats", nats)
	graph.AddService("workers", workers)
	graph.AddService("http", http)

	batches, err := graph.GetServiceBatches()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(batches) != 2 {
		t.Fatalf("Expected 2 batches, got %d", len(batches))
	}

	if len(batches[0]) != 4 {
		t.Errorf("Expected 4 services in first batch, got %d", len(batches[0]))
	}

	if len(batches[1]) != 1 {
		t.Error("Expected workers alone in second batch")
	} else if svc, ok := batches[1][0].(interface{ Name() string }); !ok || svc.Name() != "workers" {
		t.Error("Expected workers alone in second batch")
	}
}

func TestDuplicateServiceRegistration(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{})

	if err := graph.AddService("A", svcA); err != nil {
		t.Fatalf("Expected no error on first registration, got %v", err)
	}

	if err := graph.AddService("A", svcA); err == nil {
		t.Fatal("Expected error for duplicate service registration")
	}
}

func TestComplexDependencyGraph(t *testing.T) {
	graph := NewDependencyGraph()

	svcA := newMockDependencyService("A", []string{})
	svcB := newMockDependencyService("B", []string{})
	svcC := newMockDependencyService("C", []string{"A", "B"})
	svcD := newMockDependencyService("D", []string{"A"})
	svcE := newMockDependencyService("E", []string{"C", "D"})

	graph.AddService("A", svcA)
	graph.AddService("B", svcB)
	graph.AddService("C", svcC)
	graph.AddService("D", svcD)
	graph.AddService("E", svcE)

	batches, err := graph.GetServiceBatches()
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if len(batches[0]) != 2 {
		t.Errorf("Expected 2 services in first batch (A, B), got %d", len(batches[0]))
	}

	if len(batches[1]) != 2 {
		t.Errorf("Expected 2 services in second batch (C, D), got %d", len(batches[1]))
	}

	if len(batches[2]) != 1 {
		t.Error("Expected E in third batch alone")
	} else if svc, ok := batches[2][0].(interface{ Name() string }); !ok || svc.Name() != "E" {
		t.Error("Expected E in third batch alone")
	}
}
