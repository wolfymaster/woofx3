package runtime

import (
	"context"
	"fmt"
	"sync"
)

type ServicesRegistry map[string]any

type ApplicationContext struct {
	mu       sync.RWMutex
	Services ServicesRegistry
	depGraph *DependencyGraph
}

func (a *ApplicationContext) Register(serviceType string, service any) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.Services[serviceType] = service

	if err := a.depGraph.AddService(serviceType, service); err != nil {
		delete(a.Services, serviceType)
		return fmt.Errorf("failed to register service %s: %w", serviceType, err)
	}

	if err := a.depGraph.Validate(); err != nil {
		delete(a.Services, serviceType)
		a.depGraph = NewDependencyGraph()
		for name, svc := range a.Services {
			a.depGraph.AddService(name, svc)
		}
		return fmt.Errorf("dependency validation failed: %w", err)
	}

	return nil
}

func (a *ApplicationContext) GetService(serviceType string) (any, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	svc, ok := a.Services[serviceType]
	return svc, ok
}



func (a *ApplicationContext) GetServiceBatches() ([][]any, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.depGraph.GetServiceBatches()
}

type Application interface {
	Init(ctx context.Context) error
	Run(ctx context.Context) error
	Terminate(ctx context.Context) error
	Register(serviceType string, service any) error
	Context() *ApplicationContext
}

type BaseApplication struct {
	context *ApplicationContext
}

func NewBaseApplication() *BaseApplication {
	return &BaseApplication{
		context: &ApplicationContext{
			Services: make(ServicesRegistry),
			depGraph: NewDependencyGraph(),
		},
	}
}

func (a *BaseApplication) Init(ctx context.Context) error {
	return nil
}

func (a *BaseApplication) Run(ctx context.Context) error {
	<-ctx.Done()
	return nil
}

func (a *BaseApplication) Terminate(ctx context.Context) error {
	return nil
}

func (a *BaseApplication) Register(serviceType string, service any) error {
	return a.context.Register(serviceType, service)
}

func (a *BaseApplication) Context() *ApplicationContext {
	return a.context
}

type Service[T any] interface {
	Connect(ctx context.Context, appCtx *ApplicationContext) error
	Disconnect(ctx context.Context) error
	Name() string
	Type() string
	Healthcheck() bool
	Connected() bool
	Client() T
	Dependencies() []string
}



type BaseService[T any] struct {
	mu           sync.RWMutex
	name         string
	serviceType  string
	healthcheck  bool
	connected    bool
	client       T
	dependencies []string
}

func NewBaseService[T any](name, serviceType string, client T, healthcheck bool) *BaseService[T] {
	return &BaseService[T]{
		name:         name,
		serviceType:  serviceType,
		healthcheck:  healthcheck,
		connected:    false,
		client:       client,
		dependencies: []string{},
	}
}

func NewBaseServiceWithDeps[T any](name, serviceType string, client T, healthcheck bool, deps []string) *BaseService[T] {
	return &BaseService[T]{
		name:         name,
		serviceType:  serviceType,
		healthcheck:  healthcheck,
		connected:    false,
		client:       client,
		dependencies: deps,
	}
}

func (s *BaseService[T]) Connect(ctx context.Context, appCtx *ApplicationContext) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	return nil
}

func (s *BaseService[T]) Disconnect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = false
	return nil
}

func (s *BaseService[T]) Name() string {
	return s.name
}

func (s *BaseService[T]) Type() string {
	return s.serviceType
}

func (s *BaseService[T]) Healthcheck() bool {
	return s.healthcheck
}

func (s *BaseService[T]) Connected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connected
}

func (s *BaseService[T]) Client() T {
	return s.client
}

func (s *BaseService[T]) SetClient(client T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.client = client
}

func (s *BaseService[T]) Dependencies() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dependencies
}
