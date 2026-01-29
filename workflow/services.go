package main

import (
	"sync"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
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

func resolveService[T any](name string) T {
	serviceFactoriesMu.RLock()
	factory, ok := serviceFactories[name]
	serviceFactoriesMu.RUnlock()
	if !ok {
		var zero T
		return zero
	}

	typedFactory, ok := factory.(ServiceFactory[T])
	if !ok {
		var zero T
		return zero
	}

	return typedFactory()
}

type AppServices struct {
	barkloader *barkloader.Client
	messageBus *natsclient.Client
}

func (s AppServices) Barkloader() *barkloader.Client {
	return s.barkloader
}

func (s AppServices) MessageBus() *natsclient.Client {
	return s.messageBus
}

func buildAppServices() AppServices {
	return AppServices{
		barkloader: resolveService[*barkloader.Client]("barkloader"),
		messageBus: resolveService[*natsclient.Client]("messageBus"),
	}
}

func WithServices[TServices any](services TServices, action tasks.ActionFunc[TServices]) tasks.ActionFunc[TServices] {
	return func(_ tasks.ActionContext[TServices], params map[string]any) (map[string]any, error) {
		ctx := tasks.ActionContext[TServices]{
			Services: services,
		}
		return action(ctx, params)
	}
}
