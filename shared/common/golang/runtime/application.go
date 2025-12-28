package runtime

import (
	"context"
	"sync"
)

type ServicesRegistry map[string]Service

type ApplicationContext struct {
	mu       sync.RWMutex
	Services ServicesRegistry
}

func (a *ApplicationContext) Register(serviceType string, service Service) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.Services[serviceType] = service
	return nil
}

func (a *ApplicationContext) GetService(serviceType string) (Service, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	svc, ok := a.Services[serviceType]
	return svc, ok
}

type Application interface {
	Init(ctx context.Context) error
	Run(ctx context.Context) error
	Terminate(ctx context.Context) error
	Register(serviceType string, service Service) error
	Context() *ApplicationContext
}

type BaseApplication struct {
	context *ApplicationContext
}

func NewBaseApplication() *BaseApplication {
	return &BaseApplication{
		context: &ApplicationContext{
			Services: make(ServicesRegistry),
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

func (a *BaseApplication) Register(serviceType string, service Service) error {
	return a.context.Register(serviceType, service)
}

func (a *BaseApplication) Context() *ApplicationContext {
	return a.context
}

type Service interface {
	Connect(ctx context.Context) error
	Disconnect(ctx context.Context) error
	Name() string
	Type() string
	Healthcheck() bool
	Connected() bool
	Client() interface{}
}

type BaseService struct {
	mu          sync.RWMutex
	name        string
	serviceType string
	healthcheck bool
	connected   bool
	client      interface{}
}

func NewBaseService(name, serviceType string, client interface{}, healthcheck bool) *BaseService {
	return &BaseService{
		name:        name,
		serviceType: serviceType,
		healthcheck: healthcheck,
		connected:   false,
		client:      client,
	}
}

func (s *BaseService) Connect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	return nil
}

func (s *BaseService) Disconnect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = false
	return nil
}

func (s *BaseService) Name() string {
	return s.name
}

func (s *BaseService) Type() string {
	return s.serviceType
}

func (s *BaseService) Healthcheck() bool {
	return s.healthcheck
}

func (s *BaseService) Connected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connected
}

func (s *BaseService) Client() interface{} {
	return s.client
}
