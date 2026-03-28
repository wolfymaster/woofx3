package runtime

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

type Logger interface {
	Info(message string, args ...any)
	Error(message string, args ...any)
	Warn(message string, args ...any)
	Debug(message string, args ...any)
}

type noOpLogger struct{}

func (l *noOpLogger) Info(message string, args ...any)  {}
func (l *noOpLogger) Error(message string, args ...any) {}
func (l *noOpLogger) Warn(message string, args ...any)  {}
func (l *noOpLogger) Debug(message string, args ...any) {}

type stdlibLogger struct {
	logger *log.Logger
}

func (l *stdlibLogger) Info(message string, args ...any) {
	l.logger.Printf("[INFO] "+message, args...)
}
func (l *stdlibLogger) Error(message string, args ...any) {
	l.logger.Printf("[ERROR] "+message, args...)
}
func (l *stdlibLogger) Warn(message string, args ...any) {
	l.logger.Printf("[WARN] "+message, args...)
}
func (l *stdlibLogger) Debug(message string, args ...any) {
	l.logger.Printf("[DEBUG] "+message, args...)
}

type StateSubscriber func(State)

type RuntimeConfig struct {
	Application      Application
	RuntimeInit      func(context.Context, Application) error
	RuntimeTerminate func(context.Context, Application) error
	HealthMonitor    HealthMonitor
	Logger           Logger
	RootDir          string
	EnvConfig        any
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

func NewRuntime(config *RuntimeConfig) (*Runtime, error) {
	env, err := LoadRuntimeEnv(&LoadRuntimeEnvOptions{RootDir: config.RootDir})
	if err != nil {
		return nil, fmt.Errorf("LoadRuntimeEnv failed: %w", err)
	}
	appCtx := config.Application.Context()
	if config.EnvConfig != nil {
		if err := FillEnvConfig(env, config.EnvConfig); err != nil {
			return nil, fmt.Errorf("EnvConfig fill failed: %w", err)
		}
		appCtx.SetConfig(config.EnvConfig)
	}

	ctx, cancel := context.WithCancel(context.Background())

	logger := config.Logger
	if logger == nil {
		logger = &stdlibLogger{logger: log.Default()}
	}

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
	}, nil
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

	if oldState == StateTerminated && newState != StateTerminated {
		r.mu.Unlock()
		r.logger.Error("Invalid state transition from terminated state", "from", oldState, "to", newState)
		return
	}

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

func (r *Runtime) getServiceKey(service any) string {
	if typedSvc, ok := service.(interface {
		Name() string
		Type() string
	}); ok {
		return typedSvc.Name() + ":" + typedSvc.Type()
	}
	return fmt.Sprintf("%p", service)
}

func (r *Runtime) setServiceState(service any, connected bool, err error) {
	r.serviceStatesMu.Lock()
	defer r.serviceStatesMu.Unlock()

	serviceKey := r.getServiceKey(service)

	r.serviceStates[serviceKey] = &ServiceConnectionState{
		Service:   service,
		Connected: connected,
		Error:     err,
	}
}

func (r *Runtime) getServiceState(service any) *ServiceConnectionState {
	r.serviceStatesMu.RLock()
	defer r.serviceStatesMu.RUnlock()

	serviceKey := r.getServiceKey(service)

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

func (r *Runtime) isServiceTracked(service any) bool {
	r.serviceStatesMu.RLock()
	defer r.serviceStatesMu.RUnlock()

	_, exists := r.serviceStates[r.getServiceKey(service)]
	return exists
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
	case EventHealthCheckFailed:
		// Health check failed during runtime - disconnect and retry
		if currentState != StateApplicationRunning && currentState != StateServicesConnected {
			r.logger.Debug("Health check failed but not in running state, ignoring")
			return
		}
		r.logger.Warn("Health check failed, disconnecting services and retrying")
		if err := r.disconnectAllServices(); err != nil {
			r.logger.Error("Failed to disconnect services", "error", err)
		}
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
		switch event {
		case EventServicesReady:
			r.handleRuntimeInit()
		default:
			r.logger.Error("Unexpected event in StateRuntimeInit", "event", event)
		}

	case StateHealthMonitorInit:
		switch event {
		case EventServicesReady:
			r.handleHealthMonitorInit()
		case EventHealthMonitorReady:
			r.handleHealthMonitorReady()
		default:
			r.logger.Error("Unexpected event in StateHealthMonitorInit", "event", event)
		}

	case StateHealthMonitorReady:
		switch event {
		case EventServicesReady:
			r.transitionTo(StateServicesConnect)
			r.handleServicesConnect()
		default:
			r.logger.Error("Unexpected event in StateHealthMonitorReady", "event", event)
		}

	case StateHealthMonitorWaiting:
		switch event {
		case EventServicesReady:
			r.logger.Info("Retrying health monitor initialization after backoff")
			r.transitionTo(StateHealthMonitorInit)
			r.handleHealthMonitorInit()
		default:
			r.handleHealthMonitorWaiting()
		}

	case StateServicesConnect:
		switch event {
		case EventServicesReady:
			r.handleServicesConnect()
		default:
			r.logger.Error("Unexpected event in StateServicesConnect", "event", event)
		}

	case StateServicesConnectWaiting:
		switch event {
		case EventServicesReady:
			r.handleServicesConnectWaiting()
		default:
			r.logger.Error("Unexpected event in StateServicesConnectWaiting", "event", event)
		}

	case StateServicesConnected:
		switch event {
		case EventServicesReady:
			r.handleServicesConnected()
		default:
			r.logger.Error("Unexpected event in StateServicesConnected", "event", event)
		}

	case StateApplicationInit:
		switch event {
		case EventServicesReady:
			r.handleApplicationInit()
		default:
			r.logger.Error("Unexpected event in StateApplicationInit", "event", event)
		}

	case StateApplicationRunning:
		switch event {
		case EventServicesReady:
			r.handleApplicationRunning()
		default:
			r.logger.Error("Unexpected event in StateApplicationRunning", "event", event)
		}

	case StateApplicationTerminating:
		switch event {
		case EventServicesReady:
			r.handleApplicationTerminating()
		default:
			r.logger.Error("Unexpected event in StateApplicationTerminating", "event", event)
		}

	case StateRuntimeTerminating:
		switch event {
		case EventServicesReady:
			r.handleRuntimeTerminating()
		default:
			r.logger.Error("Unexpected event in StateRuntimeTerminating", "event", event)
		}

	case StateTerminated:
		r.logger.Error("Received event in StateTerminated - should not happen", "event", event)
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

	// Only initialize states for services not already tracked (e.g., by health monitor init)
	for _, batch := range serviceBatches {
		for _, svc := range batch {
			if !r.isServiceTracked(svc) {
				r.setServiceState(svc, false, nil)
			}
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
	r.transitionTo(StateServicesConnected)
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
	if r.config.HealthMonitor != nil {
		r.logger.Info("Stopping health monitor")
		r.config.HealthMonitor.Stop()
	}

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

func (r *Runtime) handleHealthMonitorInit() {
	r.transitionTo(StateHealthMonitorInit)

	monitor := r.config.HealthMonitor
	if monitor == nil {
		r.logger.Info("No health monitor configured, passing")
		r.stateChan <- EventHealthMonitorReady
		return
	}

	appCtx := r.application.Context()
	if req, ok := monitor.(RequiredServicesProvider); ok {
		for _, name := range req.RequiredServices() {
			svc, ok := appCtx.GetService(name)
			if !ok {
				r.logger.Error("Health monitor required service not registered", "service", name)
				r.stateChan <- EventHealthMonitorFailed
				return
			}
			if conn, ok := svc.(interface {
				Connect(context.Context, *ApplicationContext) error
			}); ok {
				r.logger.Info("Connecting required service for health monitor", "service", name)
				if err := conn.Connect(r.ctx, appCtx); err != nil {
					r.logger.Error("Failed to connect required service for health monitor", "service", name, "error", err)
					r.stateChan <- EventHealthMonitorFailed
					return
				}
			}
		}
	}

	if hm, ok := monitor.(HealthMonitorService); ok {
		r.logger.Info("Connecting health monitor service")
		if err := hm.Connect(r.ctx, appCtx); err != nil {
			r.logger.Error("Health monitor connect failed", "error", err)
			r.stateChan <- EventHealthMonitorFailed
			return
		}
	}

	r.logger.Info("Starting health monitor")
	if err := monitor.Start(r.ctx); err != nil {
		r.logger.Error("Health monitor failed to start", "error", err)
		r.stateChan <- EventHealthMonitorFailed
		return
	}
	r.logger.Info("Health monitor started successfully")
	r.stateChan <- EventHealthMonitorReady
}

func (r *Runtime) handleHealthMonitorReady() {
	r.transitionTo(StateHealthMonitorReady)

	// Start health monitor liveness checking
	r.logger.Info("Starting health monitor liveness checking")
	r.startHealthMonitorLiveness(r.healthMonitorLivenessCtx)

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
	monitor := r.config.HealthMonitor
	if monitor == nil {
		return
	}

	// Start liveness checker
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.logger.Debug("Performing health monitor liveness check")
				if err := monitor.Liveness(); err != nil {
					r.logger.Error("Health monitor liveness failed", "error", err)
					r.stateChan <- EventHealthMonitorFailed
					return
				}
				r.logger.Debug("Health monitor liveness check passed")
			}
		}
	}()

	// Runtime drives heartbeat and health check on an interval
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
				if err := monitor.Heartbeat(ctx); err != nil {
					r.logger.Error("Health monitor heartbeat failed", "error", err)
				}
			}
		}
	}()

	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		r.logger.Info("Starting periodic health checks")
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.logger.Debug("Running health check")
				healthy, err := monitor.HealthCheck(ctx, r.application.Context().Services)
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
