package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
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

	sharedLogger, err := logging.New(logging.Config{
		ServiceName:  "orchestrator",
		LogDirectory: filepath.Join(baseDir, "logs"),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer sharedLogger.Close()
	logger := sharedLogger.Slog()

	logger.Info("Starting orchestrator", "baseDir", baseDir)

	configPath := filepath.Join(baseDir, "services.json")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		configPath = findConfigFile(baseDir)
		if configPath == "" {
			fatalExit(sharedLogger, "services.json not found")
		}
	}

	config, err := loadConfig(configPath)
	if err != nil {
		fatalExit(sharedLogger, "Failed to load configuration", "error", err)
	}

	supervisor := NewSupervisor(baseDir, logger)

	for _, service := range config.Services {
		if service.Enabled {
			supervisor.AddService(service)
		}
	}

	if len(supervisor.services) == 0 {
		logger.Info("No enabled services found, exiting")
		return
	}

	orderedServices, err := supervisor.GetStartupOrder()
	if err != nil {
		fatalExit(sharedLogger, "Failed to resolve service dependencies", "error", err)
	}

	logger.Info("Starting services in dependency order", "count", len(orderedServices))
	supervisor.StartInOrder(orderedServices)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	logger.Info("Shutdown signal received, stopping services")

	supervisor.StopAll()
	logger.Info("All services stopped, exiting")
}

// fatalExit reports a startup failure and terminates. os.Exit skips deferred
// closers, so the logger is flushed here before the process goes away.
func fatalExit(logger *logging.Logger, message string, args ...any) {
	logger.Error(message, args...)
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
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	Path           string   `json:"path"`
	Enabled        bool     `json:"enabled"`
	Entry          string   `json:"entry,omitempty"`
	Output         string   `json:"output"`
	Dependencies   []string `json:"dependencies,omitempty"`
	HealthEndpoint string   `json:"health_endpoint,omitempty"`
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

type ServiceProcess struct {
	Service    Service
	Cmd        *os.Process
	Stop       chan bool
	Restart    chan bool
	Status     ServiceStatus
	LastHealth time.Time
	CanStart   chan bool
}

type Supervisor struct {
	baseDir  string
	services map[string]*ServiceProcess
	stopping bool
	logger   *slog.Logger
}

func NewSupervisor(baseDir string, logger *slog.Logger) *Supervisor {
	return &Supervisor{
		baseDir:  baseDir,
		services: make(map[string]*ServiceProcess),
		stopping: false,
		logger:   logger,
	}
}

func (s *Supervisor) AddService(service Service) {
	s.services[service.Name] = &ServiceProcess{
		Service:  service,
		Stop:     make(chan bool),
		Restart:  make(chan bool),
		Status:   StatusStopped,
		CanStart: make(chan bool, 1),
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
		go s.manageService(serviceProcess)

		if len(serviceProcess.Service.Dependencies) == 0 {
			select {
			case serviceProcess.CanStart <- true:
			default:
			}
		} else {
			go s.monitorDependencies(serviceProcess)
		}
	}
}

func (s *Supervisor) monitorDependencies(serviceProcess *ServiceProcess) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-serviceProcess.Stop:
			return
		case <-ticker.C:
			if s.stopping {
				return
			}

			allHealthy := true
			for _, depName := range serviceProcess.Service.Dependencies {
				if depService, exists := s.services[depName]; exists {
					if depService.Status != StatusHealthy {
						allHealthy = false
						break
					}
				} else {
					allHealthy = false
					break
				}
			}

			if allHealthy && serviceProcess.Status == StatusStopped {
				select {
				case serviceProcess.CanStart <- true:
				default:
				}
				return
			}
		}
	}
}

func (s *Supervisor) StopAll() {
	s.stopping = true
	for name, serviceProcess := range s.services {
		s.logger.Info("Stopping service", "service", name)
		select {
		case serviceProcess.Stop <- true:
		default:
		}
	}

	time.Sleep(2 * time.Second)

	for _, serviceProcess := range s.services {
		if serviceProcess.Cmd != nil {
			serviceProcess.Cmd.Kill()
		}
	}
}

func (s *Supervisor) manageService(serviceProcess *ServiceProcess) {
	service := serviceProcess.Service
	binaryName := service.Output

	if isWindows() {
		binaryName += ".exe"
	}

	binaryPath := filepath.Join(s.baseDir, binaryName)

	for {
		select {
		case <-serviceProcess.Stop:
			if serviceProcess.Cmd != nil {
				s.logger.Info("Gracefully stopping service", "service", service.Name)
				serviceProcess.Cmd.Signal(syscall.SIGTERM)
				time.Sleep(5 * time.Second)
				serviceProcess.Cmd.Kill()
			}
			return
		case <-serviceProcess.Restart:
			if serviceProcess.Cmd != nil {
				s.logger.Info("Restarting service", "service", service.Name)
				serviceProcess.Cmd.Kill()
				serviceProcess.Cmd = nil
			}
			serviceProcess.Status = StatusStopped
		case <-serviceProcess.CanStart:
			if serviceProcess.Cmd == nil && !s.stopping && serviceProcess.Status == StatusStopped {
				if err := s.startServiceProcess(serviceProcess, binaryPath); err != nil {
					s.logger.Error("Failed to start service", "service", service.Name, "error", err)
					time.Sleep(5 * time.Second)
				}
			}
		default:
			if serviceProcess.Cmd != nil && serviceProcess.Status == StatusStarting {
				if service.HealthEndpoint != "" {
					if s.checkHealth(service.HealthEndpoint) {
						serviceProcess.Status = StatusHealthy
						serviceProcess.LastHealth = time.Now()
						s.logger.Info("Service is healthy", "service", service.Name)
					} else if time.Since(serviceProcess.LastHealth) > 30*time.Second {
						serviceProcess.Status = StatusUnhealthy
						s.logger.Warn("Service health check timeout", "service", service.Name)
					}
				} else {
					serviceProcess.Status = StatusHealthy
					s.logger.Info("Service started (no health check)", "service", service.Name)
				}
			} else if serviceProcess.Cmd != nil && serviceProcess.Status == StatusHealthy && service.HealthEndpoint != "" {
				if !s.checkHealth(service.HealthEndpoint) {
					serviceProcess.Status = StatusUnhealthy
					s.logger.Warn("Service became unhealthy", "service", service.Name)
				} else {
					serviceProcess.LastHealth = time.Now()
				}
			}
		}
		time.Sleep(1 * time.Second)
	}
}

func (s *Supervisor) startServiceProcess(serviceProcess *ServiceProcess, binaryPath string) error {
	service := serviceProcess.Service

	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		return fmt.Errorf("binary not found: %s", binaryPath)
	}

	attr := &os.ProcAttr{
		Files: []*os.File{os.Stdin, os.Stdout, os.Stderr},
		Env:   os.Environ(),
	}

	process, err := os.StartProcess(binaryPath, []string{binaryPath}, attr)
	if err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	serviceProcess.Cmd = process
	serviceProcess.Status = StatusStarting
	serviceProcess.LastHealth = time.Now()
	s.logger.Info("Started service", "service", service.Name, "pid", process.Pid)

	go func() {
		state, err := process.Wait()
		if err != nil {
			s.logger.Error("Service process error", "service", service.Name, "error", err)
		} else {
			s.logger.Info("Service exited", "service", service.Name, "state", state.String())
		}
		serviceProcess.Cmd = nil
		serviceProcess.Status = StatusStopped

		if !s.stopping {
			go s.monitorDependencies(serviceProcess)
		}
	}()

	return nil
}

func (s *Supervisor) checkHealth(endpoint string) bool {
	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(endpoint)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200
}

func isWindows() bool {
	return os.Getenv("OS") == "Windows_NT" ||
		filepath.Ext(os.Args[0]) == ".exe"
}
