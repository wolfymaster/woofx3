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
	HealthMonitor    HealthMonitor   // NEW: Unified health monitor
	Heartbeat        HeartbeatFunc   // DEPRECATED: Use HealthMonitor
	HealthCheck      HealthCheckFunc // DEPRECATED: Use HealthMonitor
	Logger           Logger
}

type ServiceConnectionState struct {
	Service   any
	Connected bool
	Error     error
}

type Runtime struct {
	mu                          sync.RWMutex
	ctx                         context.Context
	cancel                      context.CancelFunc
	wg                          sync.WaitGroup
	state                       State
	stateChan                   chan Event
	shutdownChan                chan struct{}
	doneChan                    chan struct{}
	config                      *RuntimeConfig
	application                 Application
	backoff                     *Backoff
	subscribers                 []StateSubscriber
	subscribersMu               sync.RWMutex
	logger                      Logger
	serviceStates               map[string]*ServiceConnectionState
	serviceStatesMu             sync.RWMutex
	healthMonitorLivenessCtx    context.Context
	healthMonitorLivenessCancel context.CancelFunc
}

func NewRuntime(config *RuntimeConfig) *Runtime {
	ctx, cancel := context.WithCancel(context.Background())

	logger := config.Logger
	if logger == nil {
		logger = &noOpLogger{}
	}

	// Initialize health monitor liveness context
	healthMonitorLivenessCtx, healthMonitorLivenessCancel := context.WithCancel(ctx)

	return &Runtime{
		ctx:                         ctx,
		cancel:                      cancel,
		state:                       StateRuntimeInit,
		stateChan:                   make(chan Event, 10),
		shutdownChan:                make(chan struct{}),
		doneChan:                    make(chan struct{}),
		config:                      config,
		application:                 config.Application,
		backoff:                     NewBackoff(),
		subscribers:                 make([]StateSubscriber, 0),
		logger:                      logger,
		serviceStates:               make(map[string]*ServiceConnectionState),
		healthMonitorLivenessCtx:    healthMonitorLivenessCtx,
		healthMonitorLivenessCancel: healthMonitorLivenessCancel,
	}
}

func (r *Runtime) Start() *Runtime {
	r.wg.Add(1)
	go r.stateMachine()

	// Start the state machine
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

func (r *Runtime) setServiceState(service any, connected bool, err error) {
	r.serviceStatesMu.Lock()
	defer r.serviceStatesMu.Unlock()

	var serviceKey string
	if typedSvc, ok := service.(interface {
		Name() string
		Type() string
	}); ok {
		serviceKey = typedSvc.Name() + ":" + typedSvc.Type()
	} else {
		serviceKey = fmt.Sprintf("%p", service)
	}

	r.serviceStates[serviceKey] = &ServiceConnectionState{
		Service:   service,
		Connected: connected,
		Error:     err,
	}
}

func (r *Runtime) getServiceState(service any) *ServiceConnectionState {
	r.serviceStatesMu.RLock()
	defer r.serviceStatesMu.RUnlock()

	var serviceKey string
	if typedSvc, ok := service.(interface {
		Name() string
		Type() string
	}); ok {
		serviceKey = typedSvc.Name() + ":" + typedSvc.Type()
	} else {
		serviceKey = fmt.Sprintf("%p", service)
	}

	state, exists := r.serviceStates[serviceKey]
	if !exists {
		return &ServiceConnectionState{
			Service:   service,
			Connected: false,
			Error:     nil,
		}
	}
	return state
}

func (r *Runtime) getFailedServices() []any {
	r.serviceStatesMu.RLock()
	defer r.serviceStatesMu.RUnlock()

	var failed []any
	for _, state := range r.serviceStates {
		if !state.Connected {
			failed = append(failed, state.Service)
		}
	}
	return failed
}

func (r *Runtime) allServicesConnected() bool {
	r.serviceStatesMu.RLock()
	defer r.serviceStatesMu.RUnlock()

	for _, state := range r.serviceStates {
		if !state.Connected {
			return false
		}
	}
	return true
}

func (r *Runtime) resetServiceStates() {
	r.serviceStatesMu.Lock()
	defer r.serviceStatesMu.Unlock()

	r.serviceStates = make(map[string]*ServiceConnectionState)
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

	// Handle special events that can occur in any state
	switch event {
	case EventHealthMonitorFailed:
		// Only handle if we're not already in a waiting/failed state
		if currentState == StateHealthMonitorWaiting || currentState == StateTerminated {
			r.logger.Debug("Health monitor failed but already in waiting/terminated state, ignoring")
			return
		}
		r.logger.Error("Health monitor failed, disconnecting all services")
		if err := r.disconnectAllServices(); err != nil {
			r.logger.Error("Failed to disconnect services", "error", err)
		}
		// Transition to waiting state and trigger backoff
		r.transitionTo(StateHealthMonitorWaiting)
		r.handleHealthMonitorWaiting()
		return
	case EventAllServicesDisconnected:
		// After disconnecting, restart the health monitor flow
		r.stateChan <- EventServicesReady
		return
	}

	switch currentState {
	case StateRuntimeInit:
		r.handleRuntimeInit()

	case StateHealthMonitorInit:
		if event == EventServicesReady {
			r.handleHealthMonitorInit()
		} else if event == EventHealthMonitorReady {
			r.handleHealthMonitorReady()
		}

	case StateHealthMonitorReady:
		// This state should handle transition events to services connect
		if event == EventServicesReady {
			r.transitionTo(StateServicesConnect)
			r.handleServicesConnect()
		}

	case StateHealthMonitorWaiting:
		if event == EventServicesReady {
			// Retry health monitor initialization
			r.logger.Info("Retrying health monitor initialization after backoff")
			r.transitionTo(StateHealthMonitorInit)
			r.handleHealthMonitorInit()
		} else {
			r.handleHealthMonitorWaiting()
		}

	case StateHealthHeartbeat:
		r.handleHealthHeartbeat(event)

	case StateHealthHeartbeatWaiting:
		r.handleHealthHeartbeatWaiting()

	case StateServicesConnect:
		r.handleServicesConnect()

	case StateServicesConnectWaiting:
		r.handleServicesConnectWaiting()

	case StateServicesConnected:
		r.handleServicesConnected()

	case StateApplicationInit:
		r.handleApplicationInit()

	case StateApplicationRunning:
		r.handleApplicationRunning()

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

	r.transitionTo(StateHealthMonitorInit)
	r.stateChan <- EventServicesReady
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

func (r *Runtime) handleServicesConnectWaiting() {
	delay := r.backoff.Current()
	failedServices := r.getFailedServices()
	r.logger.Info("Service connection failed, backing off", "delay", delay, "failed_count", len(failedServices))

	time.AfterFunc(r.backoff.Next(), func() {
		r.transitionTo(StateServicesConnect)
		r.retryFailedServices(failedServices)
	})
}

func (r *Runtime) retryFailedServices(failedServices []any) {
	r.transitionTo(StateServicesConnect)

	if len(failedServices) == 0 {
		r.logger.Info("No failed services to retry, proceeding")
		r.backoff.Reset()
		r.resetServiceStates()
		r.transitionTo(StateServicesConnected)
		r.handleServicesConnected()
		return
	}

	r.logger.Info("Retrying failed services", "count", len(failedServices))

	appCtx := r.application.Context()
	var batchWg sync.WaitGroup

	for _, svc := range failedServices {
		svc := svc
		batchWg.Add(1)
		go func() {
			defer batchWg.Done()

			if typedSvc, ok := svc.(interface {
				Name() string
				Type() string
				Connect(context.Context, *ApplicationContext) error
			}); ok {
				r.logger.Info("Retrying service connection", "name", typedSvc.Name(), "type", typedSvc.Type())

				if err := typedSvc.Connect(r.ctx, appCtx); err != nil {
					r.setServiceState(svc, false, fmt.Errorf("service %s connection failed on retry: %w", typedSvc.Name(), err))
					r.logger.Error("Service retry failed", "name", typedSvc.Name(), "type", typedSvc.Type(), "error", err)
				} else {
					r.setServiceState(svc, true, nil)
					r.logger.Info("Service connected successfully on retry", "name", typedSvc.Name(), "type", typedSvc.Type())
				}
			} else {
				r.setServiceState(svc, false, fmt.Errorf("service does not implement required interface"))
			}
		}()
	}

	batchWg.Wait()

	// Check if all services are now connected
	if r.allServicesConnected() {
		r.backoff.Reset()
		r.resetServiceStates()
		r.transitionTo(StateServicesConnected)
		r.handleServicesConnected()
	} else {
		remainingFailed := r.getFailedServices()
		r.logger.Error("Some services still failed after retry", "remaining_failed", len(remainingFailed))
		r.transitionTo(StateServicesConnectWaiting)
		r.handleServicesConnectWaiting()
	}
}

func (r *Runtime) handleServicesConnect() {
	r.transitionTo(StateServicesConnect)
	r.logger.Info("Connecting services")

	serviceBatches, err := r.application.Context().GetServiceBatches()
	if err != nil {
		r.logger.Error("Failed to resolve service dependencies", "error", err)
		r.stateChan <- EventShutdown
		return
	}

	appCtx := r.application.Context()

	// Initialize service states for all services
	for _, batch := range serviceBatches {
		for _, svc := range batch {
			r.setServiceState(svc, false, nil)
		}
	}

	for batchIdx, batch := range serviceBatches {
		r.logger.Info("Connecting service batch", "batch", batchIdx+1, "count", len(batch))

		var batchWg sync.WaitGroup

		for _, svc := range batch {
			svc := svc
			batchWg.Add(1)
			go func() {
				defer batchWg.Done()

				// Use type assertion to get service methods
				if typedSvc, ok := svc.(interface {
					Name() string
					Type() string
					Connect(context.Context, *ApplicationContext) error
				}); ok {
					r.logger.Info("Connecting service", "name", typedSvc.Name(), "type", typedSvc.Type())

					// Skip if already successfully connected
					if state := r.getServiceState(svc); state.Connected {
						r.logger.Info("Service already connected, skipping", "name", typedSvc.Name(), "type", typedSvc.Type())
						return
					}
					if err := typedSvc.Connect(r.ctx, appCtx); err != nil {
						r.setServiceState(svc, false, fmt.Errorf("service %s connection failed: %w", typedSvc.Name(), err))
					} else {
						r.setServiceState(svc, true, nil)
						r.logger.Info("Service connected successfully", "name", typedSvc.Name(), "type", typedSvc.Type())
					}
				} else {
					r.setServiceState(svc, false, fmt.Errorf("service does not implement required interface"))
				}
			}()
		}

		batchWg.Wait()
	}

	// Check if all services are connected
	if r.allServicesConnected() {
		r.backoff.Reset()
		r.resetServiceStates()
		r.transitionTo(StateServicesConnected)
		r.handleServicesConnected()
	} else {
		failedServices := r.getFailedServices()
		r.logger.Error("Some services failed to connect", "failed_count", len(failedServices))
		for _, svc := range failedServices {
			state := r.getServiceState(svc)
			if typedSvc, ok := svc.(interface {
				Name() string
				Type() string
			}); ok {
				r.logger.Error("Failed service", "name", typedSvc.Name(), "type", typedSvc.Type(), "error", state.Error)
			} else {
				r.logger.Error("Failed service", "error", state.Error)
			}
		}
		r.transitionTo(StateServicesConnectWaiting)
		r.handleServicesConnectWaiting()
	}
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
	serviceBatches, err := r.application.Context().GetServiceBatches()
	if err != nil {
		r.logger.Error("Failed to resolve service dependencies for shutdown", "error", err)
		services := r.application.Context().Services
		for _, svc := range services {
			if typedSvc, ok := svc.(interface {
				Name() string
				Disconnect(context.Context) error
			}); ok {
				if err := typedSvc.Disconnect(r.ctx); err != nil {
					r.logger.Error("Service disconnection failed", "service", typedSvc.Name(), "error", err)
				}
			}
		}
	} else {
		for i := len(serviceBatches) - 1; i >= 0; i-- {
			batch := serviceBatches[i]
			r.logger.Info("Disconnecting service batch", "batch", i+1, "count", len(batch))

			var batchWg sync.WaitGroup
			for _, svc := range batch {
				svc := svc
				batchWg.Add(1)
				go func() {
					defer batchWg.Done()
					if typedSvc, ok := svc.(interface {
						Name() string
						Disconnect(context.Context) error
					}); ok {
						r.logger.Info("Disconnecting service", "name", typedSvc.Name())
						if err := typedSvc.Disconnect(r.ctx); err != nil {
							r.logger.Error("Service disconnection failed", "service", typedSvc.Name(), "error", err)
						}
					}
				}()
			}
		}
	}
}

// Health Monitor Lifecycle Handlers

func (r *Runtime) handleHealthMonitorInit() {
	r.transitionTo(StateHealthMonitorInit)

	// Prefer new HealthMonitor interface, fall back to legacy functions
	if r.config.HealthMonitor != nil {
		r.logger.Info("Starting health monitor")
		if err := r.config.HealthMonitor.Start(r.ctx); err != nil {
			r.logger.Error("Health monitor failed to start", "error", err)
			r.stateChan <- EventHealthMonitorFailed
			return
		}
		r.logger.Info("Health monitor started successfully")
		r.stateChan <- EventHealthMonitorReady
		return
	}

	// Fallback to legacy health check/heartbeat approach
	if r.config.HealthCheck == nil {
		r.logger.Info("No health check configured, passing")
		r.stateChan <- EventHealthMonitorReady
		return
	}

	r.stateChan <- EventHealthMonitorReady
}

func (r *Runtime) handleHealthMonitorReady() {
	r.transitionTo(StateHealthMonitorReady)

	// Start health monitor liveness checking
	r.logger.Info("Starting health monitor liveness checking")
	r.startHealthMonitorLiveness(r.healthMonitorLivenessCtx)

	// Start traditional health check if configured
	if r.config.HealthMonitor == nil && r.config.HealthCheck != nil {
		r.logger.Info("Starting traditional health check and heartbeat")
		r.startHealthCheck(r.ctx)
		r.startHeartbeat(r.ctx)
	}

	// Move to services connection phase
	r.logger.Info("Health monitor ready, proceeding to services connection")
	r.stateChan <- EventServicesReady
}

func (r *Runtime) handleHealthMonitorWaiting() {
	delay := r.backoff.Current()
	r.logger.Info("Health monitor waiting, backing off", "delay", delay)

	time.AfterFunc(r.backoff.Next(), func() {
		r.logger.Info("Health monitor backoff complete, retrying initialization")
		r.stateChan <- EventServicesReady
	})
}

func (r *Runtime) startHealthMonitorLiveness(ctx context.Context) {
	if r.config.HealthMonitor == nil {
		return // No liveness checking for legacy mode
	}

	// Start liveness checker
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(3 * time.Second) // Check health monitor every 3 seconds
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.logger.Debug("Performing health monitor liveness check")
				if err := r.config.HealthMonitor.Liveness(); err != nil {
					r.logger.Error("Health monitor liveness failed", "error", err)
					r.stateChan <- EventHealthMonitorFailed
					return
				}
				r.logger.Debug("Health monitor liveness check passed")
			}
		}
	}()

	// Start periodic health checking if the monitor supports it
	if combinedMonitor, ok := r.config.HealthMonitor.(CombinedHealthMonitor); ok {
		r.logger.Info("Starting periodic health checks")
		r.wg.Add(1)
		go func() {
			defer r.wg.Done()
			ticker := time.NewTicker(5 * time.Second) // Check health every 5 seconds
			defer ticker.Stop()

			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					r.logger.Debug("Running health check")
					healthy, err := combinedMonitor.HealthCheck(ctx, r.application.Context().Services)
					if err != nil {
						r.logger.Error("Health check failed with error", "error", err)
						r.stateChan <- EventHealthCheckFailed
						continue
					}
					if !healthy {
						r.logger.Warn("Health check failed - system unhealthy")
						r.stateChan <- EventHealthCheckFailed
						continue
					}
					r.logger.Debug("Health check passed - system healthy")
				}
			}
		}()
	}
}

func (r *Runtime) disconnectAllServices() error {
	r.logger.Info("Disconnecting all services due to health monitor failure")

	// Stop health monitor liveness checking
	if r.healthMonitorLivenessCancel != nil {
		r.healthMonitorLivenessCancel()
		// Recreate the context for next attempt
		r.healthMonitorLivenessCtx, r.healthMonitorLivenessCancel = context.WithCancel(r.ctx)
	}

	// Stop health monitor
	if r.config.HealthMonitor != nil {
		r.logger.Info("Stopping health monitor")
		r.config.HealthMonitor.Stop()
	}

	// Disconnect all connected services
	for name, service := range r.application.Context().Services {
		if typedSvc, ok := service.(interface{ Disconnect(context.Context) error }); ok {
			r.logger.Info("Disconnecting service", "service", name)
			if err := typedSvc.Disconnect(r.ctx); err != nil {
				r.logger.Error("Failed to disconnect service", "service", name, "error", err)
			}
		}
	}

	// Reset service states
	r.resetServiceStates()

	// Don't terminate - transition to waiting state instead
	r.logger.Info("All services disconnected, will retry after backoff")
	return nil
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
					// Don't return - continue monitoring
					continue
				}

				r.logger.Debug("Health check passed")
				// Don't send success event after initial startup, just continue monitoring
				// Initial success is handled in handleHealthHeartbeat
			}
		}
	}()
}
