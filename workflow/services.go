package main

import (
	"fmt"
	"sync"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

type ServiceFactory[T any] func() T

var (
	serviceFactories   = make(map[string]any)
	serviceFactoriesMu sync.RWMutex
)

func registerService[T any](name string, factory ServiceFactory[T]) {
	serviceFactoriesMu.Lock()
	defer serviceFactoriesMu.Unlock()
	serviceFactories[name] = factory
}

func resolveService[T any](name string) (T, error) {
	var zero T

	serviceFactoriesMu.RLock()
	factory, ok := serviceFactories[name]
	serviceFactoriesMu.RUnlock()
	if !ok {
		return zero, fmt.Errorf("service %q is not registered", name)
	}

	typedFactory, ok := factory.(ServiceFactory[T])
	if !ok {
		return zero, fmt.Errorf("service %q is registered as %T, not the requested type", name, factory)
	}

	return typedFactory(), nil
}

type AppServices struct {
	barkloader *barkloader.Client
	messageBus *natsclient.Client
	alertLog   dbv1.AlertService
	gateway    PlatformGateway
}

func (s AppServices) Barkloader() *barkloader.Client {
	return s.barkloader
}

func (s AppServices) MessageBus() *natsclient.Client {
	return s.messageBus
}

// AlertLog records dispatched alerts so a consumer can report back against
// them. Nil when the engine is running without a db proxy, which callers must
// tolerate rather than treat as fatal: an alert is worth more than its log.
func (s AppServices) AlertLog() dbv1.AlertService {
	return s.alertLog
}

// PlatformGateway is the one way an action produces an effect on a streaming
// platform, such as posting a chat line.
func (s AppServices) PlatformGateway() PlatformGateway {
	return s.gateway
}

func buildAppServices() (AppServices, error) {
	bark, err := resolveService[*barkloader.Client]("barkloader")
	if err != nil {
		return AppServices{}, err
	}
	bus, err := resolveService[*natsclient.Client]("messageBus")
	if err != nil {
		return AppServices{}, err
	}
	alertLog, err := resolveService[dbv1.AlertService]("alertLog")
	if err != nil {
		return AppServices{}, err
	}
	gateway, err := resolveService[PlatformGateway]("platformGateway")
	if err != nil {
		return AppServices{}, err
	}
	return AppServices{barkloader: bark, messageBus: bus, alertLog: alertLog, gateway: gateway}, nil
}

func WithServices[TServices any](services TServices, action tasks.ActionFunc[TServices]) tasks.ActionFunc[TServices] {
	return func(incoming tasks.ActionContext[TServices], params map[string]any) (map[string]any, error) {
		ctx := tasks.ActionContext[TServices]{
			Services:     services,
			WorkflowID:   incoming.WorkflowID,
			ExecutionID:  incoming.ExecutionID,
			TaskID:       incoming.TaskID,
			TriggerEvent: incoming.TriggerEvent,
			Logger:       incoming.Logger,
			Context:      incoming.Context,
		}
		return action(ctx, params)
	}
}
