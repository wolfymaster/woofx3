package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	woofx3config "github.com/wolfymaster/woofx3/common/config"
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

	sources, err := woofx3config.LoadSources(woofx3config.ResolveLocation(""))
	if err != nil {
		fatalExit(sharedLogger, reporter, "Failed to load the runtime configuration", err)
	}
	config, err := loadConfig(configPath, runtimeGetenv(sources))
	if err != nil {
		fatalExit(sharedLogger, reporter, "Failed to load configuration", err)
	}

	workDir, err := os.Getwd()
	if err != nil {
		fatalExit(sharedLogger, reporter, "Failed to get the working directory", err)
	}
	if err := copyLegacyData(workDir, woofx3config.DataDir(), logger); err != nil {
		fatalExit(sharedLogger, reporter, "Failed to copy existing engine data into the data directory", err)
	}

	// Every service that reads one of these refuses to start without a
	// usable value, so each is resolved, and generated on first run, here.
	engineSecrets := []SecretSpec{
		{Name: "barkloader-key", EnvKey: "WOOFX3_BARKLOADER_KEY", ConfigKey: "barkloaderKey"},
		{Name: "scene-manager-token-secret", EnvKey: "WOOFX3_SCENE_MANAGER_TOKEN_SECRET", ConfigKey: "sceneManagerTokenSecret"},
	}
	secrets, err := ResolveSecrets(engineSecrets, sources, engineStateDir(workDir, woofx3config.DataDir()), rand.Reader, logger)
	if err != nil {
		fatalExit(sharedLogger, reporter, "Failed to resolve the engine secrets", err)
	}

	serviceIO := childIO{envOverrides: secrets}
	if options.statusToStdout {
		serviceIO.outputDirectory = logging.ResolveLogDirectory(logDirectory)
	}
	if options.exitOnStdinEOF {
		// The services must not read the stdin whose EOF stops the
		// orchestrator, nor keep it open.
		devNull, err := os.Open(os.DevNull)
		if err != nil {
			fatalExit(sharedLogger, reporter, "Failed to open the null device", err)
		}
		defer devNull.Close()
		serviceIO.stdin = devNull
	}
	supervisor := NewSupervisor(baseDir, logger, reporter, serviceIO)

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
			if err := waitForEOF(os.Stdin); err != nil {
				logger.Warn("Reading standard input failed, stopping as if it had closed", "error", err)
			}
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

// runtimeGetenv looks up WOOFX3_* settings the way the services do: the
// process environment, then .env, then .woofx3.json, as loaded from the
// working directory the services inherit. Health endpoints expanded with it
// follow a port set in .woofx3.json (apiPort) as well as one set by variable,
// so they check the port the service actually listens on.
func runtimeGetenv(sources woofx3config.Sources) func(string) string {
	env := sources.Merge()
	return func(key string) string { return env[key] }
}

// loadConfig reads services.json and resolves each enabled service's health
// endpoint with getenv, so a configuration that leaves one unusable stops the
// orchestrator before it starts anything.
func loadConfig(path string, getenv func(string) string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config JSON: %w", err)
	}

	for i, service := range config.Services {
		// A disabled service's endpoint may name variables that only the
		// deployments running it set.
		if !service.Enabled {
			continue
		}
		resolved, err := resolveService(service, getenv)
		if err != nil {
			return nil, err
		}
		config.Services[i] = resolved
	}

	return &config, nil
}

// resolveService fills in the fields of service that loadConfig derives from
// its configuration.
func resolveService(service Service, getenv func(string) string) (Service, error) {
	service.healthTimeout = defaultHealthTimeout
	if service.HealthTimeout != "" {
		timeout, err := time.ParseDuration(service.HealthTimeout)
		if err != nil {
			return Service{}, fmt.Errorf("service %s: health_timeout: %w", service.Name, err)
		}
		if timeout <= 0 {
			return Service{}, fmt.Errorf("service %s: health_timeout %q is not positive", service.Name, service.HealthTimeout)
		}
		service.healthTimeout = timeout
	}
	if service.HealthEndpoint != "" {
		healthURL, err := resolveEndpoint(service.HealthEndpoint, getenv)
		if err != nil {
			return Service{}, fmt.Errorf("service %s: health_endpoint: %w", service.Name, err)
		}
		service.healthURL = healthURL
	}
	return service, nil
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
	// HealthTimeout is how long the service has, once started, to pass its
	// health check before it is reported unhealthy: a Go duration such as
	// "90s". Empty means defaultHealthTimeout.
	HealthTimeout string `json:"health_timeout,omitempty"`

	// healthURL and healthTimeout are HealthEndpoint, with its variables
	// expanded, and HealthTimeout, parsed, as set by resolveService.
	// healthURL is empty when the service has no health endpoint.
	healthURL     string
	healthTimeout time.Duration
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
				reporter.service(service.Name, StatusSkipped, 0, "prebuilt binary not installed")
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
	// StatusSkipped is a service that is not run: its prebuilt binary is not
	// installed.
	StatusSkipped
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
	case StatusSkipped:
		return "skipped"
	default:
		panic(fmt.Sprintf("unknown service status %d", int(status)))
	}
}

// satisfiesDependents reports whether the services that depend on one in this
// status may start. A healthy service does. So does an unhealthy one: it is
// running, and its health check either timed out while it started or failed
// later. Holding its dependents back for good would stop the engine on a
// check that may be wrong (a port mismatch, a slow dependency) rather than
// on the service itself, so the check gates them for the service's health
// timeout at most.
func (status ServiceStatus) satisfiesDependents() bool {
	return status == StatusHealthy || status == StatusUnhealthy
}

// defaultHealthTimeout is how long a starting service with a health endpoint
// has to pass its check, unless its health_timeout says otherwise, before it
// is reported unhealthy and its dependents start anyway.
const defaultHealthTimeout = 30 * time.Second

// stopGracePeriod is how long the services have, after the orchestrator is
// asked to stop, to exit on their own before whatever is left is killed. A
// host that stops the engine must allow more than this before it kills the
// container.
const stopGracePeriod = 25 * time.Second

// dependentStopPeriod is the part of stopGracePeriod the services that depend
// on others get to themselves, before the services they depend on are asked
// to stop. It must cover the workflow engine's Stop (DefaultStopDrainTimeout
// plus DefaultStopSettleTimeout in workflow/internal/engine/engine.go), which
// records through db-proxy the runs it could not finish, and the run
// recorder's drain after it (DefaultRecorderDrainTimeout in
// workflow/async_run_recorder.go). What is left of
// stopGracePeriod must cover db-proxy's final flush of module storage to its
// replica (closeTimeout in db/app/services/module_storage_service.go); a kill
// mid-flush loses the writes since the last sync.
const dependentStopPeriod = 8 * time.Second

// exitRecordPeriod bounds how long StopAll waits, once it has killed what was
// left, for the supervisor's goroutines to record and report each exit. A
// killed process exits at once unless the OS cannot reap it; the bound keeps
// such a process from holding the orchestrator open.
const exitRecordPeriod = 5 * time.Second

// supervisorConfig holds the supervisor's timings. defaultSupervisorConfig is
// what the orchestrator runs with.
type supervisorConfig struct {
	// pollInterval paces each service's loop (start requests and health
	// checks) and each wait for a service's dependencies.
	pollInterval time.Duration
	// startFailureDelay is the pause in a service's loop after it failed to
	// start.
	startFailureDelay time.Duration
	// healthRequestTimeout bounds one health check request.
	healthRequestTimeout time.Duration
	// stopPollInterval paces the checks for exited services while stopping.
	stopPollInterval time.Duration
	// stopGracePeriod, dependentStopPeriod and exitRecordPeriod default to,
	// and are described by, the constants of the same names.
	stopGracePeriod     time.Duration
	dependentStopPeriod time.Duration
	exitRecordPeriod    time.Duration
}

func defaultSupervisorConfig() supervisorConfig {
	return supervisorConfig{
		pollInterval:         1 * time.Second,
		startFailureDelay:    5 * time.Second,
		healthRequestTimeout: 5 * time.Second,
		stopPollInterval:     100 * time.Millisecond,
		stopGracePeriod:      stopGracePeriod,
		dependentStopPeriod:  dependentStopPeriod,
		exitRecordPeriod:     exitRecordPeriod,
	}
}

// ServiceProcess is one supervised service. Cmd, Status and LastHealth are
// shared between the service's goroutines and guarded by the supervisor's mu.
type ServiceProcess struct {
	Service Service
	// healthURL is the service's health endpoint with its variables expanded,
	// or empty when it has none.
	healthURL string
	// healthTimeout is how long the service has to pass its health check
	// once started.
	healthTimeout time.Duration
	Cmd           serviceHandle
	Status        ServiceStatus
	LastHealth    time.Time
	CanStart      chan bool
}

type Supervisor struct {
	baseDir  string
	services map[string]*ServiceProcess
	logger   *slog.Logger
	config   supervisorConfig

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
	childIO    childIO
}

// childIO is what the services inherit from the orchestrator: what their
// standard streams are connected to, and their environment. The zero value
// shares the orchestrator's own.
type childIO struct {
	// stdin replaces the orchestrator's stdin for the services when set.
	stdin *os.File
	// outputDirectory, when set, receives each service's stdout and stderr in
	// a file of its own instead of the orchestrator's.
	outputDirectory string
	// envOverrides are set in each service's environment over the
	// orchestrator's own (see serviceEnvironment).
	envOverrides map[string]string
}

// NewSupervisor returns a supervisor of no services yet. reporter may be nil,
// to report nothing.
func NewSupervisor(baseDir string, logger *slog.Logger, reporter *statusReporter, serviceIO childIO) *Supervisor {
	ctx, cancel := context.WithCancel(context.Background())
	config := defaultSupervisorConfig()
	supervisor := &Supervisor{
		config:       config,
		baseDir:      baseDir,
		services:     make(map[string]*ServiceProcess),
		stopping:     false,
		logger:       logger,
		ctx:          ctx,
		cancel:       cancel,
		clock:        systemClock{},
		startProcess: startOSProcess,
		httpClient:   &http.Client{Timeout: config.healthRequestTimeout},
		reporter:     reporter,
		childIO:      serviceIO,
	}
	supervisor.checkHealth = supervisor.checkHealthOverHTTP
	return supervisor
}

// AddService adds a service that resolveService has resolved.
func (s *Supervisor) AddService(service Service) {
	if service.healthTimeout <= 0 {
		panic(fmt.Sprintf("service %s was added without being resolved", service.Name))
	}
	s.services[service.Name] = &ServiceProcess{
		Service:       service,
		healthURL:     service.healthURL,
		healthTimeout: service.healthTimeout,
		Status:        StatusStopped,
		CanStart:      make(chan bool, 1),
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
		if err := s.clock.Sleep(s.ctx, s.config.pollInterval); err != nil {
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
	deadline := s.clock.Now().Add(s.config.stopGracePeriod)
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
	s.waitForExit(dependents, s.clock.Now().Add(s.config.dependentStopPeriod))
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

// waitForGoroutines waits up to the exit record period for the supervisor's
// goroutines to end. It uses the wall clock rather than s.clock: what it waits
// for is the OS reaping killed processes.
func (s *Supervisor) waitForGoroutines() {
	done := make(chan struct{})
	go func() {
		s.goroutines.Wait()
		close(done)
	}()
	timer := time.NewTimer(s.config.exitRecordPeriod)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		s.logger.Warn("Services were killed but their exits were not recorded in time", "waited", s.config.exitRecordPeriod)
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
		s.clock.Sleep(context.Background(), s.config.stopPollInterval)
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
		s.clock.Sleep(context.Background(), s.config.stopPollInterval)
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
					if err := s.clock.Sleep(s.ctx, s.config.startFailureDelay); err != nil {
						return
					}
				}
			}
		default:
			s.updateHealth(serviceProcess)
		}
		if err := s.clock.Sleep(s.ctx, s.config.pollInterval); err != nil {
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
		} else if s.clock.Now().Sub(lastHealth) > serviceProcess.healthTimeout {
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
//
// Status events about a service are emitted under s.mu, with the change they
// report, so they go out in the order the changes were made: a health check
// passing as the process exits cannot be reported after its stopped event.
// The reporter's lock is only ever taken inside s.mu, never the other way.
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
	s.reporter.service(serviceProcess.Service.Name, to, process.Pid(), "")
	nowReady := !s.readyReported && s.allHealthyLocked()
	if nowReady {
		s.readyReported = true
		s.reporter.ready()
	}
	s.mu.Unlock()

	if nowReady {
		s.logger.Info("All services are healthy")
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
		Env:   serviceEnvironment(os.Environ(), s.childIO.envOverrides),
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
	s.reporter.service(service.Name, StatusStarting, process.Pid(), "")
	s.mu.Unlock()
	s.logger.Info("Started service", "service", service.Name, "pid", process.Pid())
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
		s.reporter.service(service.Name, StatusStopped, process.Pid(), exit)
		s.mu.Unlock()

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
	if s.childIO.stdin != nil {
		stdin = s.childIO.stdin
	}
	if s.childIO.outputDirectory == "" {
		return []*os.File{stdin, os.Stdout, os.Stderr}, func() {}, nil
	}

	if err := os.MkdirAll(s.childIO.outputDirectory, 0o755); err != nil {
		return nil, nil, fmt.Errorf("create service output directory: %w", err)
	}
	path := filepath.Join(s.childIO.outputDirectory, childOutputFileName(serviceName))
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o644)
	if err != nil {
		return nil, nil, fmt.Errorf("open service output file: %w", err)
	}
	closeOutput := func() {
		if err := output.Close(); err != nil {
			s.logger.Warn("Could not close the service output file", "service", serviceName, "error", err)
		}
	}
	return []*os.File{stdin, output, output}, closeOutput, nil
}

// resolveEndpoint fills ${NAME} and ${NAME:-default} in a health endpoint
// from getenv, so services.json can follow a port the deployment configures,
// and checks that the result is an absolute http(s) URL. A variable that is
// unset or empty takes its default; one without a default is an error rather
// than an empty port, which would only show as a check that never passes.
func resolveEndpoint(endpoint string, getenv func(string) string) (string, error) {
	var unset []string
	expanded := os.Expand(endpoint, func(reference string) string {
		name, fallback, hasDefault := strings.Cut(reference, ":-")
		if value := getenv(name); value != "" {
			return value
		}
		if !hasDefault {
			unset = append(unset, name)
		}
		return fallback
	})
	if len(unset) > 0 {
		return "", fmt.Errorf("%q uses %s, which is unset and has no default", endpoint, strings.Join(unset, ", "))
	}

	parsed, err := url.Parse(expanded)
	if err != nil {
		return "", fmt.Errorf("%q expands to %q, which is not a URL: %w", endpoint, expanded, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%q expands to %q, which is not an http or https URL", endpoint, expanded)
	}
	if parsed.Hostname() == "" || strings.HasSuffix(parsed.Host, ":") {
		return "", fmt.Errorf("%q expands to %q, which has no host or an empty port", endpoint, expanded)
	}
	return expanded, nil
}

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
