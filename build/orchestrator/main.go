package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wolfymaster/woofx3/common/logging"
)

func main() {
	execPath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to get executable path: %v\n", err)
		os.Exit(1)
	}
	baseDir := filepath.Dir(execPath)

	options, err := parseSupervisionOptions(os.Args[1:], os.Getenv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Invalid arguments: %v\n", err)
		os.Exit(2)
	}

	logDirectory := filepath.Join(baseDir, "logs")
	loggingConfig := logging.Config{
		ServiceName:  "orchestrator",
		LogDirectory: logDirectory,
	}
	if options.statusToStdout {
		// Stdout carries the status lines alone.
		loggingConfig.EnableFileTransport = true
	}
	sharedLogger, err := logging.New(loggingConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer sharedLogger.Close()
	logger := sharedLogger.Slog()

	reporter, err := newStatusReporter(options, os.Stdout, systemClock{}, logger)
	if err != nil {
		fatalExit(sharedLogger, nil, "Failed to open the status output", err)
	}
	defer reporter.Close()

	logger.Info("Starting orchestrator", "baseDir", baseDir)

	configPath := filepath.Join(baseDir, "services.json")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		configPath = findConfigFile(baseDir)
		if configPath == "" {
			fatalExit(sharedLogger, reporter, "services.json not found", nil)
		}
	}

	config, err := loadConfig(configPath)
	if err != nil {
		fatalExit(sharedLogger, reporter, "Failed to load configuration", err)
	}

	supervisor := NewSupervisor(baseDir, logger)
	supervisor.reporter = reporter
	if options.statusToStdout {
		supervisor.childOutputDirectory = logging.ResolveLogDirectory(logDirectory)
	}
	if options.exitOnStdinEOF {
		// The services must not read the stdin whose EOF stops the
		// orchestrator, nor keep it open.
		devNull, err := os.Open(os.DevNull)
		if err != nil {
			fatalExit(sharedLogger, reporter, "Failed to open the null device", err)
		}
		defer devNull.Close()
		supervisor.childStdin = devNull
	}

	for _, service := range servicesToRun(baseDir, config, logger, reporter) {
		supervisor.AddService(service)
	}

	if len(supervisor.services) == 0 {
		logger.Info("No enabled services found, exiting")
		reporter.stopped()
		return
	}

	orderedServices, err := supervisor.GetStartupOrder()
	if err != nil {
		fatalExit(sharedLogger, reporter, "Failed to resolve service dependencies", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	stdinClosed := make(chan struct{})
	if options.exitOnStdinEOF {
		go func() {
			waitForEOF(os.Stdin)
			close(stdinClosed)
		}()
	}

	if err := bindServicesToOrchestratorLifetime(); err != nil {
		// The services still run and still stop with the orchestrator; only
		// an orchestrator that is killed outright leaves them behind.
		logger.Warn("Services will outlive the orchestrator if it is killed", "error", err)
	}

	logger.Info("Starting services in dependency order", "count", len(orderedServices))
	supervisor.StartInOrder(orderedServices)

	select {
	case <-sigChan:
		logger.Info("Shutdown signal received, stopping services")
	case <-stdinClosed:
		logger.Info("Standard input closed, stopping services")
	}

	supervisor.StopAll()
	logger.Info("All services stopped, exiting")
	reporter.stopped()
}

// fatalExit reports a startup failure and terminates. os.Exit skips deferred
// closers, so the logger and the status output are flushed here before the
// process goes away.
func fatalExit(logger *logging.Logger, reporter *statusReporter, message string, err error) {
	if err != nil {
		logger.Error(message, "error", err)
		reporter.failure("", fmt.Sprintf("%s: %v", message, err))
	} else {
		logger.Error(message)
		reporter.failure("", message)
	}
	reporter.Close()
	logger.Close()
	os.Exit(1)
}

func findConfigFile(startDir string) string {
	dir := startDir
	for {
		configPath := filepath.Join(dir, "services.json")
		if _, err := os.Stat(configPath); err == nil {
			return configPath
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config JSON: %w", err)
	}

	return &config, nil
}

type Config struct {
	Services []Service `json:"services"`
	Build    Build     `json:"build"`
}

type Service struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
	Entry   string `json:"entry,omitempty"`
	Output  string `json:"output"`
	// Args are passed to the binary after its own path.
	Args           []string `json:"args,omitempty"`
	Dependencies   []string `json:"dependencies,omitempty"`
	HealthEndpoint string   `json:"health_endpoint,omitempty"`
}

// serviceTypeBinary marks a service the build does not produce: a prebuilt
// binary that the packager installs beside the others (the Caddy edge, in the
// container image). A package that did not install it runs without it.
const serviceTypeBinary = "binary"

// servicesToRun returns the enabled services, minus prebuilt binaries that are
// not installed. Those are skipped with a warning rather than retried forever:
// a release archive has no edge, and runs its services directly.
func servicesToRun(baseDir string, config *Config, logger *slog.Logger, reporter *statusReporter) []Service {
	var out []Service
	for _, service := range config.Services {
		if !service.Enabled {
			continue
		}
		if service.Type == serviceTypeBinary {
			binaryPath := filepath.Join(baseDir, binaryFileName(service))
			if _, err := os.Stat(binaryPath); err != nil {
				logger.Warn("Skipping service: its prebuilt binary is not installed", "service", service.Name, "path", binaryPath)
				reporter.skipped(service.Name, "prebuilt binary not installed")
				continue
			}
		}
		out = append(out, service)
	}
	return out
}

// binaryFileName is the file a service runs from, relative to the base dir.
// The release packages every service for the orchestrator's own target, so the
// orchestrator's build OS is the services' OS.
func binaryFileName(service Service) string {
	if runtime.GOOS == "windows" {
		return service.Output + ".exe"
	}
	return service.Output
}

// serviceArgv is the argument vector a service is started with.
func serviceArgv(binaryPath string, service Service) []string {
	return append([]string{binaryPath}, service.Args...)
}

type Build struct {
	OutputDir string   `json:"output_dir"`
	Targets   []string `json:"targets"`
}

type ServiceStatus int

const (
	StatusStopped ServiceStatus = iota
	StatusStarting
	StatusHealthy
	StatusUnhealthy
)

// String is the status as reported in status events.
func (status ServiceStatus) String() string {
	switch status {
	case StatusStopped:
		return "stopped"
	case StatusStarting:
		return "starting"
	case StatusHealthy:
		return "healthy"
	case StatusUnhealthy:
		return "unhealthy"
	default:
		panic(fmt.Sprintf("unknown service status %d", int(status)))
	}
}

// satisfiesDependents reports whether the services that depend on one in this
// status may start. A healthy service does. So does an unhealthy one: it is
// running, and its health check either timed out while it started or failed
// later. Holding its dependents back for good would stop the engine on a
// check that may be wrong (a port mismatch, a slow dependency) rather than
// on the service itself, so the check gates them for healthCheckTimeout at
// most.
func (status ServiceStatus) satisfiesDependents() bool {
	return status == StatusHealthy || status == StatusUnhealthy
}

// healthCheckTimeout is how long a starting service with a health endpoint
// has to pass its check before it is reported unhealthy and its dependents
// start anyway.
const healthCheckTimeout = 30 * time.Second

// ServiceProcess is one supervised service. Cmd, Status and LastHealth are
// shared between the service's goroutines and guarded by the supervisor's mu.
type ServiceProcess struct {
	Service Service
	// healthURL is the service's health endpoint with its variables expanded,
	// or empty when it has none.
	healthURL  string
	Cmd        serviceHandle
	Status     ServiceStatus
	LastHealth time.Time
	CanStart   chan bool
}

type Supervisor struct {
	baseDir  string
	services map[string]*ServiceProcess
	logger   *slog.Logger

	// ctx is cancelled when StopAll begins. The polling loops and in-flight
	// health checks end with it; stopping the processes does not use it.
	ctx    context.Context
	cancel context.CancelFunc
	// goroutines counts every goroutine the supervisor starts, so StopAll can
	// return only once each service's exit has been recorded and reported.
	goroutines sync.WaitGroup

	// mu guards stopping, stopDeadline, readyReported and every
	// ServiceProcess's Cmd, Status and LastHealth.
	mu       sync.Mutex
	stopping bool
	// stopDeadline is when StopAll kills what is still running; set with
	// stopping.
	stopDeadline time.Time
	// readyReported is set once every service has been healthy at the same
	// time; the ready event is sent once per run.
	readyReported bool

	clock        clock
	startProcess processStarter
	checkHealth  func(ctx context.Context, endpoint string) bool
	// httpClient makes the health checks; one client, so they reuse
	// connections.
	httpClient *http.Client
	reporter   *statusReporter
	// childStdin replaces the orchestrator's stdin for the services when set.
	childStdin *os.File
	// childOutputDirectory, when set, receives each service's stdout and
	// stderr in a file of its own instead of the orchestrator's.
	childOutputDirectory string
}

func NewSupervisor(baseDir string, logger *slog.Logger) *Supervisor {
	ctx, cancel := context.WithCancel(context.Background())
	supervisor := &Supervisor{
		baseDir:      baseDir,
		services:     make(map[string]*ServiceProcess),
		stopping:     false,
		logger:       logger,
		ctx:          ctx,
		cancel:       cancel,
		clock:        systemClock{},
		startProcess: startOSProcess,
		httpClient:   &http.Client{Timeout: healthRequestTimeout},
	}
	supervisor.checkHealth = supervisor.checkHealthOverHTTP
	return supervisor
}

func (s *Supervisor) AddService(service Service) {
	s.services[service.Name] = &ServiceProcess{
		Service:   service,
		healthURL: expandEndpoint(service.HealthEndpoint, os.Getenv),
		Status:    StatusStopped,
		CanStart:  make(chan bool, 1),
	}
}

func (s *Supervisor) GetStartupOrder() ([]string, error) {
	var result []string
	visited := make(map[string]bool)
	visiting := make(map[string]bool)

	var visit func(string) error
	visit = func(name string) error {
		if visiting[name] {
			return fmt.Errorf("circular dependency detected involving service: %s", name)
		}
		if visited[name] {
			return nil
		}

		serviceProcess, exists := s.services[name]
		if !exists {
			return fmt.Errorf("dependency not found: %s", name)
		}

		visiting[name] = true

		for _, dep := range serviceProcess.Service.Dependencies {
			if err := visit(dep); err != nil {
				return err
			}
		}

		visiting[name] = false
		visited[name] = true
		result = append(result, name)

		return nil
	}

	var names []string
	for name := range s.services {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		if err := visit(name); err != nil {
			return nil, err
		}
	}

	return result, nil
}

func (s *Supervisor) StartInOrder(orderedServices []string) {
	for _, name := range orderedServices {
		serviceProcess := s.services[name]
		s.logger.Info("Starting service", "service", name)
		s.spawn(func() { s.manageService(serviceProcess) })

		if len(serviceProcess.Service.Dependencies) == 0 {
			select {
			case serviceProcess.CanStart <- true:
			default:
			}
		} else {
			s.spawn(func() { s.monitorDependencies(serviceProcess) })
		}
	}
}

// spawn runs f on a goroutine that StopAll waits for.
func (s *Supervisor) spawn(f func()) {
	s.goroutines.Add(1)
	go func() {
		defer s.goroutines.Done()
		f()
	}()
}

func (s *Supervisor) monitorDependencies(serviceProcess *ServiceProcess) {
	for {
		if err := s.clock.Sleep(s.ctx, 1*time.Second); err != nil {
			return
		}

		s.mu.Lock()
		allStarted := true
		for _, depName := range serviceProcess.Service.Dependencies {
			if depService, exists := s.services[depName]; exists {
				if !depService.Status.satisfiesDependents() {
					allStarted = false
					break
				}
			} else {
				allStarted = false
				break
			}
		}
		stopped := serviceProcess.Status == StatusStopped
		s.mu.Unlock()

		if allStarted && stopped {
			select {
			case serviceProcess.CanStart <- true:
			default:
			}
			return
		}
	}
}

// stopGracePeriod is how long the services have, after the orchestrator is
// asked to stop, to exit on their own before whatever is left is killed. A
// host that stops the engine must allow more than this before it kills the
// container.
const stopGracePeriod = 25 * time.Second

// dependentStopPeriod is the part of stopGracePeriod the services that depend
// on others get to themselves, before the services they depend on are asked
// to stop. It must cover the workflow engine's Stop (DefaultStopDrainTimeout
// plus DefaultStopSettleTimeout in workflow/internal/engine/engine.go), which
// records through db-proxy the runs it could not finish. What is left of
// stopGracePeriod must cover db-proxy's final flush of module storage to its
// replica (closeTimeout in db/app/services/module_storage_service.go); a kill
// mid-flush loses the writes since the last sync.
const dependentStopPeriod = 8 * time.Second

// exitRecordPeriod bounds how long StopAll waits, once it has killed what was
// left, for the supervisor's goroutines to record and report each exit. A
// killed process exits at once unless the OS cannot reap it; the bound keeps
// such a process from holding the orchestrator open.
const exitRecordPeriod = 5 * time.Second

// StopAll stops the services in two phases and kills whatever is still running
// once the grace period is over. It returns once every service's exit has been
// reported, so the caller's own final status comes after them.
//
// Services that depend on others are stopped first, and the services with no
// dependencies (db-proxy and the message bus) only once those have exited or
// used up their share of the time. A service shutting down still has work to
// write down and announce, and it can do neither after the database proxy and
// the bus have gone.
func (s *Supervisor) StopAll() {
	deadline := s.clock.Now().Add(stopGracePeriod)
	s.mu.Lock()
	s.stopping = true
	s.stopDeadline = deadline
	s.mu.Unlock()
	s.cancel()

	var dependents, foundations []string
	for name, serviceProcess := range s.services {
		if len(serviceProcess.Service.Dependencies) > 0 {
			dependents = append(dependents, name)
		} else {
			foundations = append(foundations, name)
		}
	}

	s.signalStop(dependents)
	s.waitForExit(dependents, s.clock.Now().Add(dependentStopPeriod))
	s.signalStop(foundations)
	s.waitForExit(append(dependents, foundations...), deadline)

	for name, serviceProcess := range s.services {
		if process := s.process(serviceProcess); process != nil {
			s.logger.Warn("Service did not exit within the grace period, killing it", "service", name)
			process.Kill()
		}
	}

	s.waitForGoroutines()
}

// waitForGoroutines waits up to exitRecordPeriod for the supervisor's
// goroutines to end. It uses the wall clock rather than s.clock: what it waits
// for is the OS reaping killed processes.
func (s *Supervisor) waitForGoroutines() {
	done := make(chan struct{})
	go func() {
		s.goroutines.Wait()
		close(done)
	}()
	timer := time.NewTimer(exitRecordPeriod)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		s.logger.Warn("Services were killed but their exits were not recorded in time", "waited", exitRecordPeriod)
	}
}

// process is the service's running process, or nil.
func (s *Supervisor) process(serviceProcess *ServiceProcess) serviceHandle {
	s.mu.Lock()
	defer s.mu.Unlock()
	return serviceProcess.Cmd
}

// signalStop asks each named service that is running to stop.
func (s *Supervisor) signalStop(names []string) {
	for _, name := range names {
		process := s.process(s.services[name])
		if process == nil {
			continue
		}
		s.requestStop(name, process)
	}
}

// requestStop asks a service's process to stop, and kills it when it cannot
// be asked.
func (s *Supervisor) requestStop(name string, process serviceHandle) {
	s.logger.Info("Stopping service", "service", name)
	if err := process.RequestStop(); err != nil {
		s.logger.Warn("Could not ask service to stop, killing it", "service", name, "error", err)
		process.Kill()
	}
}

// stopLateStart stops a process that was started while StopAll was already
// under way, as StopAll does: a stop request, then a kill at the deadline. The
// phase of StopAll that would have signalled it may have looked before it
// existed, so it cannot be left to StopAll.
func (s *Supervisor) stopLateStart(serviceProcess *ServiceProcess, process serviceHandle, deadline time.Time) {
	name := serviceProcess.Service.Name
	s.requestStop(name, process)
	running := func() bool { return s.process(serviceProcess) == process }
	for running() && s.clock.Now().Before(deadline) {
		s.clock.Sleep(context.Background(), 100*time.Millisecond)
	}
	if running() {
		s.logger.Warn("Service did not exit within the grace period, killing it", "service", name)
		process.Kill()
	}
}

// waitForExit returns once none of the named services is running, or at the
// deadline.
func (s *Supervisor) waitForExit(names []string, deadline time.Time) {
	// s.ctx is already cancelled while stopping.
	for s.anyRunning(names) && s.clock.Now().Before(deadline) {
		s.clock.Sleep(context.Background(), 100*time.Millisecond)
	}
}

func (s *Supervisor) anyRunning(names []string) bool {
	for _, name := range names {
		if s.process(s.services[name]) != nil {
			return true
		}
	}
	return false
}

func (s *Supervisor) manageService(serviceProcess *ServiceProcess) {
	service := serviceProcess.Service
	binaryPath := filepath.Join(s.baseDir, binaryFileName(service))

	for {
		select {
		case <-serviceProcess.CanStart:
			s.mu.Lock()
			startable := serviceProcess.Cmd == nil && !s.stopping && serviceProcess.Status == StatusStopped
			s.mu.Unlock()
			if startable {
				if err := s.startServiceProcess(serviceProcess, binaryPath); err != nil {
					s.logger.Error("Failed to start service", "service", service.Name, "error", err)
					s.reporter.failure(service.Name, fmt.Sprintf("failed to start: %v", err))
					if err := s.clock.Sleep(s.ctx, 5*time.Second); err != nil {
						return
					}
				}
			}
		default:
			s.updateHealth(serviceProcess)
		}
		if err := s.clock.Sleep(s.ctx, 1*time.Second); err != nil {
			return
		}
	}
}

// updateHealth moves a running service between starting, healthy and
// unhealthy by its health check, or straight to healthy once started when it
// has none. An unhealthy service is still checked, and becomes healthy again
// when its check passes.
func (s *Supervisor) updateHealth(serviceProcess *ServiceProcess) {
	service := serviceProcess.Service
	healthURL := serviceProcess.healthURL

	s.mu.Lock()
	process := serviceProcess.Cmd
	status := serviceProcess.Status
	lastHealth := serviceProcess.LastHealth
	s.mu.Unlock()
	if process == nil {
		return
	}

	switch {
	case status == StatusStarting && healthURL == "":
		if s.transition(serviceProcess, process, StatusStarting, StatusHealthy) {
			s.logger.Info("Service started (no health check)", "service", service.Name)
		}
	case status == StatusStarting:
		if s.checkHealth(s.ctx, healthURL) {
			if s.transition(serviceProcess, process, StatusStarting, StatusHealthy) {
				s.logger.Info("Service is healthy", "service", service.Name)
			}
		} else if s.clock.Now().Sub(lastHealth) > healthCheckTimeout {
			if s.transition(serviceProcess, process, StatusStarting, StatusUnhealthy) {
				s.logger.Warn("Service health check timeout, starting its dependents anyway", "service", service.Name, "endpoint", healthURL)
			}
		}
	case status == StatusHealthy && healthURL != "":
		if !s.checkHealth(s.ctx, healthURL) {
			if s.transition(serviceProcess, process, StatusHealthy, StatusUnhealthy) {
				s.logger.Warn("Service became unhealthy", "service", service.Name)
			}
		} else {
			s.mu.Lock()
			serviceProcess.LastHealth = s.clock.Now()
			s.mu.Unlock()
		}
	case status == StatusUnhealthy && healthURL != "":
		if s.checkHealth(s.ctx, healthURL) {
			if s.transition(serviceProcess, process, StatusUnhealthy, StatusHealthy) {
				s.logger.Info("Service is healthy", "service", service.Name)
			}
		}
	}
}

// transition moves the service from one status to another, unless its
// process has changed or its status has moved on since the caller looked: a
// health check that passes just as the process exits must not mark the
// stopped service healthy. It reports the change and, the first time every
// service is healthy, that the engine is ready.
func (s *Supervisor) transition(serviceProcess *ServiceProcess, process serviceHandle, from ServiceStatus, to ServiceStatus) bool {
	s.mu.Lock()
	if serviceProcess.Cmd != process || serviceProcess.Status != from {
		s.mu.Unlock()
		return false
	}
	serviceProcess.Status = to
	if to == StatusHealthy {
		serviceProcess.LastHealth = s.clock.Now()
	}
	nowReady := !s.readyReported && s.allHealthyLocked()
	if nowReady {
		s.readyReported = true
	}
	s.mu.Unlock()

	s.reporter.service(serviceProcess.Service.Name, to, process.Pid(), "")
	if nowReady {
		s.logger.Info("All services are healthy")
		s.reporter.ready()
	}
	return true
}

func (s *Supervisor) allHealthyLocked() bool {
	for _, serviceProcess := range s.services {
		if serviceProcess.Status != StatusHealthy {
			return false
		}
	}
	return true
}

func (s *Supervisor) startServiceProcess(serviceProcess *ServiceProcess, binaryPath string) error {
	service := serviceProcess.Service

	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		return fmt.Errorf("binary not found: %s", binaryPath)
	}

	files, closeFiles, err := s.childFiles(service.Name)
	if err != nil {
		return err
	}
	attr := &os.ProcAttr{
		Files: files,
		Env:   os.Environ(),
	}

	process, err := s.startProcess(binaryPath, serviceArgv(binaryPath, service), attr)
	// The child holds its own copies of the descriptors.
	closeFiles()
	if err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	s.mu.Lock()
	serviceProcess.Cmd = process
	serviceProcess.Status = StatusStarting
	serviceProcess.LastHealth = s.clock.Now()
	startedWhileStopping := s.stopping
	stopDeadline := s.stopDeadline
	s.mu.Unlock()
	s.logger.Info("Started service", "service", service.Name, "pid", process.Pid())
	s.reporter.service(service.Name, StatusStarting, process.Pid(), "")
	if startedWhileStopping {
		s.spawn(func() { s.stopLateStart(serviceProcess, process, stopDeadline) })
	}

	s.spawn(func() {
		exit, err := process.Wait()
		if err != nil {
			s.logger.Error("Service process error", "service", service.Name, "error", err)
			exit = err.Error()
		} else {
			s.logger.Info("Service exited", "service", service.Name, "state", exit)
		}
		s.mu.Lock()
		serviceProcess.Cmd = nil
		serviceProcess.Status = StatusStopped
		stopping := s.stopping
		s.mu.Unlock()
		s.reporter.service(service.Name, StatusStopped, process.Pid(), exit)

		if !stopping {
			s.spawn(func() { s.monitorDependencies(serviceProcess) })
		}
	})

	return nil
}

// childFiles are the stdin, stdout and stderr a service starts with, and a
// function that closes the ones opened for it.
func (s *Supervisor) childFiles(serviceName string) ([]*os.File, func(), error) {
	stdin := os.Stdin
	if s.childStdin != nil {
		stdin = s.childStdin
	}
	if s.childOutputDirectory == "" {
		return []*os.File{stdin, os.Stdout, os.Stderr}, func() {}, nil
	}

	if err := os.MkdirAll(s.childOutputDirectory, 0o755); err != nil {
		return nil, nil, fmt.Errorf("create service output directory: %w", err)
	}
	path := filepath.Join(s.childOutputDirectory, childOutputFileName(serviceName))
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
	if err != nil {
		return nil, nil, fmt.Errorf("open service output file: %w", err)
	}
	return []*os.File{stdin, output, output}, func() { output.Close() }, nil
}

// expandEndpoint fills ${NAME} and ${NAME:-default} in a health endpoint from
// the environment, so services.json can follow a port the deployment
// configures. A variable that is unset or empty takes its default, or
// expands to nothing without one.
func expandEndpoint(endpoint string, getenv func(string) string) string {
	return os.Expand(endpoint, func(reference string) string {
		name, fallback, _ := strings.Cut(reference, ":-")
		if value := getenv(name); value != "" {
			return value
		}
		return fallback
	})
}

// healthRequestTimeout bounds one health check request.
const healthRequestTimeout = 5 * time.Second

// checkHealthOverHTTP reports whether a GET of endpoint answers 200. A
// cancelled ctx ends the request at once.
func (s *Supervisor) checkHealthOverHTTP(ctx context.Context, endpoint string) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		s.logger.Warn("Health endpoint is not a valid request", "endpoint", endpoint, "error", err)
		return false
	}
	response, err := s.httpClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()

	return response.StatusCode == http.StatusOK
}
