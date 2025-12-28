package runtime

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Logger interface {
	Info(message string, args ...interface{})
	Error(message string, args ...interface{})
	Warn(message string, args ...interface{})
	Debug(message string, args ...interface{})
}

type noOpLogger struct{}

func (l *noOpLogger) Info(message string, args ...interface{})  {}
func (l *noOpLogger) Error(message string, args ...interface{}) {}
func (l *noOpLogger) Warn(message string, args ...interface{})  {}
func (l *noOpLogger) Debug(message string, args ...interface{}) {}

type StateSubscriber func(State)

type RuntimeConfig struct {
	Application      Application
	RuntimeInit      func(context.Context, Application) error
	RuntimeTerminate func(context.Context, Application) error
	Heartbeat        HeartbeatFunc
	HealthCheck      HealthCheckFunc
	Logger           Logger
}

type Runtime struct {
	mu            sync.RWMutex
	ctx           context.Context
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	state         State
	stateChan     chan Event
	shutdownChan  chan struct{}
	doneChan      chan struct{}
	config        *RuntimeConfig
	application   Application
	backoff       *Backoff
	subscribers   []StateSubscriber
	subscribersMu sync.RWMutex
	logger        Logger
}

func NewRuntime(config *RuntimeConfig) *Runtime {
	ctx, cancel := context.WithCancel(context.Background())

	logger := config.Logger
	if logger == nil {
		logger = &noOpLogger{}
	}

	return &Runtime{
		ctx:          ctx,
		cancel:       cancel,
		state:        StateRuntimeInit,
		stateChan:    make(chan Event, 10),
		shutdownChan: make(chan struct{}),
		doneChan:     make(chan struct{}),
		config:       config,
		application:  config.Application,
		backoff:      NewBackoff(),
		subscribers:  make([]StateSubscriber, 0),
		logger:       logger,
	}
}

func (r *Runtime) Start() *Runtime {
	r.wg.Add(1)
	go r.stateMachine()

	r.stateChan <- EventServicesReady

	return r
}

func (r *Runtime) Stop() error {
	close(r.shutdownChan)

	timeout := time.After(30 * time.Second)
	select {
	case <-r.doneChan:
		return nil
	case <-timeout:
		r.logger.Warn("Shutdown timeout, forcing cancellation")
		r.cancel()
		return fmt.Errorf("shutdown timeout")
	}
}

func (r *Runtime) GetState() State {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state
}

func (r *Runtime) Subscribe(callback StateSubscriber) func() {
	r.subscribersMu.Lock()
	defer r.subscribersMu.Unlock()

	r.subscribers = append(r.subscribers, callback)

	idx := len(r.subscribers) - 1
	return func() {
		r.subscribersMu.Lock()
		defer r.subscribersMu.Unlock()
		if idx < len(r.subscribers) {
			r.subscribers = append(r.subscribers[:idx], r.subscribers[idx+1:]...)
		}
	}
}

func (r *Runtime) Wait() {
	<-r.doneChan
}

func (r *Runtime) transitionTo(newState State) {
	r.mu.Lock()
	oldState := r.state
	r.state = newState
	r.mu.Unlock()

	r.logger.Info("State transition", "from", oldState, "to", newState)
	r.notifySubscribers(newState)
}

func (r *Runtime) notifySubscribers(state State) {
	r.subscribersMu.RLock()
	defer r.subscribersMu.RUnlock()

	for _, subscriber := range r.subscribers {
		subscriber(state)
	}
}

func (r *Runtime) stateMachine() {
	defer r.wg.Done()
	defer close(r.doneChan)

	for {
		select {
		case <-r.ctx.Done():
			r.handleShutdown()
			return

		case <-r.shutdownChan:
			r.handleShutdown()
			return

		case event := <-r.stateChan:
			if event == EventShutdown {
				r.handleShutdown()
				return
			}

			r.handleEvent(event)
		}
	}
}

func (r *Runtime) handleEvent(event Event) {
	currentState := r.GetState()

	switch currentState {
	case StateRuntimeInit:
		r.handleRuntimeInit()

	case StateHealthHeartbeat:
		r.handleHealthHeartbeat(event)

	case StateHealthHeartbeatWaiting:
		r.handleHealthHeartbeatWaiting()

	case StateServicesConnect:
		r.handleServicesConnect()

	case StateServicesConnected:
		r.handleServicesConnected()

	case StateApplicationInit:
		r.handleApplicationInit()

	case StateApplicationRunning:

	case StateApplicationTerminating:
		r.handleApplicationTerminating()

	case StateRuntimeTerminating:
		r.handleRuntimeTerminating()

	case StateTerminated:
	}
}

func (r *Runtime) handleRuntimeInit() {
	r.transitionTo(StateRuntimeInit)

	if r.config.RuntimeInit != nil {
		if err := r.config.RuntimeInit(r.ctx, r.application); err != nil {
			r.logger.Error("Runtime init failed", "error", err)
			r.stateChan <- EventShutdown
			return
		}
	}

	r.transitionTo(StateHealthHeartbeat)
	r.handleHealthHeartbeat(EventServicesReady)
}

func (r *Runtime) handleHealthHeartbeat(event Event) {
	if event == EventHealthCheckPassed {
		r.backoff.Reset()
		r.transitionTo(StateServicesConnect)
		r.handleServicesConnect()
		return
	}

	if event == EventHealthCheckFailed {
		r.transitionTo(StateHealthHeartbeatWaiting)
		r.handleHealthHeartbeatWaiting()
		return
	}

	r.startHeartbeat(r.ctx)
	r.startHealthCheck(r.ctx)
}

func (r *Runtime) handleHealthHeartbeatWaiting() {
	delay := r.backoff.Current()
	r.logger.Info("Health check failed, backing off", "delay", delay)

	time.AfterFunc(r.backoff.Next(), func() {
		r.transitionTo(StateHealthHeartbeat)
		r.handleHealthHeartbeat(EventServicesReady)
	})
}

func (r *Runtime) handleServicesConnect() {
	r.transitionTo(StateServicesConnect)

	services := r.application.Context().Services
	errChan := make(chan error, len(services))

	// Use a separate WaitGroup for services to avoid deadlock with state machine
	var serviceWg sync.WaitGroup

	for _, svc := range services {
		svc := svc
		serviceWg.Add(1)
		go func() {
			defer serviceWg.Done()
			if err := svc.Connect(r.ctx); err != nil {
				errChan <- err
			}
		}()
	}

	serviceWg.Wait()
	close(errChan)

	for err := range errChan {
		if err != nil {
			r.logger.Error("Service connection failed", "error", err)
			r.stateChan <- EventShutdown
			return
		}
	}

	r.transitionTo(StateServicesConnected)
	r.handleServicesConnected()
}

func (r *Runtime) handleServicesConnected() {
	r.transitionTo(StateApplicationInit)
	r.handleApplicationInit()
}

func (r *Runtime) handleApplicationInit() {
	if err := r.application.Init(r.ctx); err != nil {
		r.logger.Error("Application init failed", "error", err)
		r.stateChan <- EventShutdown
		return
	}

	r.transitionTo(StateApplicationRunning)
	r.handleApplicationRunning()
}

func (r *Runtime) handleApplicationRunning() {
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		if err := r.application.Run(r.ctx); err != nil {
			r.logger.Error("Application run failed", "error", err)
		}
	}()
}

func (r *Runtime) handleApplicationTerminating() {
	r.transitionTo(StateApplicationTerminating)

	if err := r.application.Terminate(r.ctx); err != nil {
		r.logger.Error("Application terminate failed", "error", err)
	}

	r.transitionTo(StateRuntimeTerminating)
	r.handleRuntimeTerminating()
}

func (r *Runtime) handleRuntimeTerminating() {
	services := r.application.Context().Services

	for _, svc := range services {
		svc := svc
		r.wg.Add(1)
		go func() {
			defer r.wg.Done()
			if err := svc.Disconnect(r.ctx); err != nil {
				r.logger.Error("Service disconnection failed", "service", svc.Name(), "error", err)
			}
		}()
	}

	r.wg.Wait()

	if r.config.RuntimeTerminate != nil {
		if err := r.config.RuntimeTerminate(r.ctx, r.application); err != nil {
			r.logger.Error("Runtime terminate hook failed", "error", err)
		}
	}

	r.transitionTo(StateTerminated)
}

func (r *Runtime) handleShutdown() {
	currentState := r.GetState()

	if currentState == StateTerminated {
		return
	}

	if currentState == StateApplicationRunning {
		r.cancel()
		r.handleApplicationTerminating()
	} else {
		r.cancel()
		r.transitionTo(StateRuntimeTerminating)
		r.handleRuntimeTerminating()
	}
}

func (r *Runtime) startHeartbeat(ctx context.Context) {
	if r.config.Heartbeat == nil {
		r.logger.Info("No heartbeat configured, skipping")
		return
	}

	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := r.config.Heartbeat(ctx); err != nil {
					r.logger.Error("Heartbeat failed", "error", err)
				}
			}
		}
	}()
}

func (r *Runtime) startHealthCheck(ctx context.Context) {
	if r.config.HealthCheck == nil {
		r.logger.Info("No health check configured, passing")
		r.stateChan <- EventHealthCheckPassed
		return
	}

	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				healthy, err := r.config.HealthCheck(ctx, r.application.Context().Services)
				if err != nil || !healthy {
					r.logger.Debug("Health check failed", "healthy", healthy, "error", err)
					r.stateChan <- EventHealthCheckFailed
					return
				}

				r.logger.Debug("Health check passed")
				r.stateChan <- EventHealthCheckPassed
				return
			}
		}
	}()
}
