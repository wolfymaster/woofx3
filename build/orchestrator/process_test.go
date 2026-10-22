package main

import (
	"bufio"
	"errors"
	"os"
	"os/signal"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"syscall"
	"testing"
	"time"
)

// helperModeEnv makes the test binary act as a service that exits cleanly
// when it is asked to stop, so the real process starter can be exercised
// against a process that behaves like one.
const helperModeEnv = "ORCHESTRATOR_TEST_HELPER"

func TestMain(m *testing.M) {
	if os.Getenv(helperModeEnv) == "graceful-service" {
		runGracefulServiceHelper()
		return
	}
	os.Exit(m.Run())
}

// runGracefulServiceHelper handles stop requests the way the Go services do,
// and says on stdout once it is ready for one. A stop request that arrives
// before the handler is installed would kill it instead.
func runGracefulServiceHelper() {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	os.Stdout.WriteString("ready\n")
	select {
	case <-stop:
		os.Exit(0)
	case <-time.After(30 * time.Second):
		os.Exit(3)
	}
}

// On Linux and macOS the stop request is SIGTERM; on Windows it is
// CTRL_BREAK_EVENT to the service's own process group. Either way a service
// that handles it exits on its own rather than being killed.
func TestAServiceStartedByTheOrchestratorExitsCleanlyWhenAskedToStop(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("executable: %v", err)
	}
	stdoutReader, stdoutWriter, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	defer stdoutReader.Close()

	process, err := startOSProcess(executable, []string{executable}, &os.ProcAttr{
		Files: []*os.File{os.Stdin, stdoutWriter, os.Stderr},
		Env:   append(os.Environ(), helperModeEnv+"=graceful-service"),
	})
	stdoutWriter.Close()
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() { process.Kill() })

	line, err := bufio.NewReader(stdoutReader).ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatalf("helper did not get ready: %q, %v", line, err)
	}

	if err := process.RequestStop(); err != nil {
		t.Fatalf("request stop: %v", err)
	}
	exited := make(chan processExit, 1)
	go func() {
		state, err := process.Wait()
		if err != nil {
			state = processExit{description: err.Error()}
		}
		exited <- state
	}()

	select {
	case state := <-exited:
		if !state.success || state.description != "exit status 0" {
			t.Fatalf("service exited with %+v, want a clean exit", state)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("service did not exit after it was asked to stop")
	}
}

// scriptedProcess records what the supervisor asks of it, and exits when
// asked to stop only if it is polite.
type scriptedProcess struct {
	name    string
	polite  bool
	stopErr error
	// reapDelay is how long Wait takes to return after the process exits.
	reapDelay  time.Duration
	clock      clock
	calls      *callLog
	exited     chan struct{}
	exitedOnce sync.Once
}

type callLog struct {
	mu    sync.Mutex
	calls []string
	times map[string]time.Time
}

func (l *callLog) record(call string, at time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls = append(l.calls, call)
	if l.times == nil {
		l.times = make(map[string]time.Time)
	}
	l.times[call] = at
}

func (l *callLog) snapshot() ([]string, map[string]time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	times := make(map[string]time.Time, len(l.times))
	for call, at := range l.times {
		times[call] = at
	}
	return append([]string(nil), l.calls...), times
}

func (p *scriptedProcess) Pid() int { return 1 }

func (p *scriptedProcess) RequestStop() error {
	p.calls.record(p.name+":stop", p.clock.Now())
	if p.stopErr != nil {
		return p.stopErr
	}
	if p.polite {
		p.exit()
	}
	return nil
}

func (p *scriptedProcess) Kill() error {
	p.calls.record(p.name+":kill", p.clock.Now())
	p.exit()
	return nil
}

func (p *scriptedProcess) Wait() (processExit, error) {
	<-p.exited
	time.Sleep(p.reapDelay)
	p.calls.record(p.name+":exited", p.clock.Now())
	return processExit{description: "exit status 0", success: true}, nil
}

func (p *scriptedProcess) exit() {
	p.exitedOnce.Do(func() { close(p.exited) })
}

// startScripted starts one scripted process per service on a fake clock and
// returns the supervisor with them running, and where its status goes.
func startScripted(t *testing.T, processes map[string]*scriptedProcess) (*Supervisor, *fakeClock, *callLog, *syncBuffer) {
	t.Helper()
	services := make([]Service, 0, len(processes))
	for name := range processes {
		services = append(services, Service{Name: name, Output: name})
	}
	return startScriptedServices(t, services, processes)
}

// startScriptedServices is startScripted for services declared in full. Each
// service with a process in processes is started; the others are added and
// left stopped.
func startScriptedServices(t *testing.T, services []Service, processes map[string]*scriptedProcess) (*Supervisor, *fakeClock, *callLog, *syncBuffer) {
	t.Helper()
	clock := newFakeClock()
	calls := &callLog{}
	output := &syncBuffer{}
	reporter, err := newStatusReporter(supervisionOptions{statusToStdout: true}, output, clock, discardLogger())
	if err != nil {
		t.Fatalf("reporter: %v", err)
	}
	supervisor := NewSupervisor(t.TempDir(), discardLogger(), reporter, childIO{})
	supervisor.clock = clock
	supervisor.startProcess = func(path string, argv []string, attr *os.ProcAttr) (serviceHandle, error) {
		process := processes[filepath.Base(path)]
		process.clock = clock
		process.calls = calls
		process.exited = make(chan struct{})
		return process, nil
	}
	for _, service := range services {
		supervisor.AddService(mustResolve(t, service))
	}
	for name, process := range processes {
		process.name = name
		binaryPath := filepath.Join(supervisor.baseDir, name)
		if err := os.WriteFile(binaryPath, []byte{}, 0o755); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		if err := supervisor.startServiceProcess(supervisor.services[name], binaryPath); err != nil {
			t.Fatalf("start %s: %v", name, err)
		}
	}
	return supervisor, clock, calls, output
}

func TestStopAllAsksEveryServiceToStopAndKillsOnlyThoseStillRunningAfterTheGracePeriod(t *testing.T) {
	supervisor, clock, calls, _ := startScripted(t, map[string]*scriptedProcess{
		"polite":   {polite: true},
		"stubborn": {polite: false},
	})
	stopStarted := clock.Now()

	supervisor.StopAll()

	got, times := calls.snapshot()
	for _, call := range []string{"polite:stop", "stubborn:stop", "stubborn:kill"} {
		if _, ok := times[call]; !ok {
			t.Fatalf("calls = %v, missing %s", got, call)
		}
	}
	if _, ok := times["polite:kill"]; ok {
		t.Fatalf("calls = %v: a service that exited when asked was killed", got)
	}
	if !times["stubborn:stop"].Before(times["stubborn:kill"]) {
		t.Fatalf("calls = %v: the stubborn service was killed before it was asked to stop", got)
	}
	if waited := times["stubborn:kill"].Sub(stopStarted); waited < stopGracePeriod {
		t.Fatalf("the stubborn service was killed after %s, before the %s grace period was over", waited, stopGracePeriod)
	}
}

func TestAServiceThatCannotBeAskedToStopIsKilledAtOnce(t *testing.T) {
	supervisor, _, calls, _ := startScripted(t, map[string]*scriptedProcess{
		"unreachable": {stopErr: errors.New("no console to send the event through")},
	})

	supervisor.StopAll()

	got, times := calls.snapshot()
	if !reflect.DeepEqual(got, []string{"unreachable:stop", "unreachable:kill", "unreachable:exited"}) {
		t.Fatalf("calls = %v, want a stop request then a kill", got)
	}
	if !times["unreachable:kill"].Equal(times["unreachable:stop"]) {
		t.Fatalf("the kill came %s after the failed stop request, want no wait", times["unreachable:kill"].Sub(times["unreachable:stop"]))
	}
}

// The orchestrator reports stopped once StopAll returns, and closes its status
// output: a service's own stopped event must already be out by then, including
// that of a service that had to be killed.
func TestStopAllReturnsOnceEveryServicesExitIsReported(t *testing.T) {
	supervisor, _, _, output := startScripted(t, map[string]*scriptedProcess{
		"stubborn":    {polite: false, reapDelay: 20 * time.Millisecond},
		"unreachable": {stopErr: errors.New("no console"), reapDelay: 20 * time.Millisecond},
	})

	supervisor.StopAll()

	stopped := map[string]bool{}
	for _, event := range output.events(t) {
		if event.Event == eventService && event.Status == StatusStopped.String() {
			stopped[event.Name] = true
		}
	}
	if !stopped["stubborn"] || !stopped["unreachable"] {
		t.Fatalf("stopped reported for %v when StopAll returned, want both killed services", stopped)
	}
}

// StopAll can begin while a service is being started, after the supervisor
// decided to start it and before the process exists. That process must still
// be asked to stop, not left for the kill at the end of the grace period.
func TestAServiceStartedWhileStoppingIsAskedToStopAtOnce(t *testing.T) {
	clock := newFakeClock()
	calls := &callLog{}
	supervisor := NewSupervisor(t.TempDir(), discardLogger(), nil, childIO{})
	supervisor.clock = clock
	supervisor.AddService(mustResolve(t, Service{Name: "late", Output: "late"}))
	binaryPath := filepath.Join(supervisor.baseDir, "late")
	if err := os.WriteFile(binaryPath, []byte{}, 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}

	stopAllDone := make(chan struct{})
	stopStarted := clock.Now()
	supervisor.startProcess = func(string, []string, *os.ProcAttr) (serviceHandle, error) {
		// StopAll begins, and has signalled the services it can see, while
		// this one is being created.
		go func() {
			supervisor.StopAll()
			close(stopAllDone)
		}()
		waitFor(t, "StopAll to begin", func() bool {
			supervisor.mu.Lock()
			defer supervisor.mu.Unlock()
			return supervisor.stopping
		})
		return &scriptedProcess{name: "late", polite: true, clock: clock, calls: calls, exited: make(chan struct{})}, nil
	}
	// As from the service's loop, which StopAll waits for.
	supervisor.spawn(func() {
		if err := supervisor.startServiceProcess(supervisor.services["late"], binaryPath); err != nil {
			t.Errorf("start: %v", err)
		}
	})
	<-stopAllDone

	got, times := calls.snapshot()
	if !reflect.DeepEqual(got, []string{"late:stop", "late:exited"}) {
		t.Fatalf("calls = %v, want one stop request and no kill", got)
	}
	if waited := times["late:stop"].Sub(stopStarted); waited >= stopGracePeriod {
		t.Fatalf("asked to stop %s after StopAll began, want before the grace period was over", waited)
	}
}

// The shipped services.json, as the orchestrator runs it once the migration
// has completed: every service is asked to stop only once every service that
// depends on it has exited, so db-proxy and the message bus outlive everything
// that writes through them. A dependency on the completed migrate step must
// not move db-proxy into an earlier wave.
func TestStopAllStopsTheShippedServicesInReverseDependencyOrder(t *testing.T) {
	config, err := loadConfig(filepath.Join("..", "config", "services.json"), func(string) string { return "" })
	if err != nil {
		t.Fatalf("load services.json: %v", err)
	}
	var services []Service
	processes := map[string]*scriptedProcess{}
	for _, service := range config.Services {
		if !service.Enabled {
			continue
		}
		service.Output = service.Name
		services = append(services, service)
		if !service.RunOnce {
			// Exits when asked, and is reaped a little later, so a service
			// asked to stop too early is seen to be.
			processes[service.Name] = &scriptedProcess{polite: true, reapDelay: 5 * time.Millisecond}
		}
	}
	supervisor, _, calls, _ := startScriptedServices(t, services, processes)
	supervisor.services["migrate"].Status = StatusCompleted

	supervisor.StopAll()

	got, _ := calls.snapshot()
	at := func(call string) int {
		index := slices.Index(got, call)
		if index < 0 {
			t.Fatalf("calls = %v, missing %s", got, call)
		}
		return index
	}
	for _, service := range services {
		if service.RunOnce {
			if slices.Contains(got, service.Name+":stop") || slices.Contains(got, service.Name+":kill") {
				t.Errorf("calls = %v: the completed %s step was signalled", got, service.Name)
			}
			continue
		}
		for _, dependency := range service.Dependencies {
			if supervisor.services[dependency].Service.RunOnce {
				continue
			}
			if at(dependency+":stop") < at(service.Name+":exited") {
				t.Errorf("%s was asked to stop before %s, which depends on it, had exited: %v", dependency, service.Name, got)
			}
		}
	}
	if at("db-proxy:stop") < at("wooflow:exited") {
		t.Errorf("db-proxy was asked to stop while wooflow could still be recording through it: %v", got)
	}
}

// A run-once step still running when the engine stops is never asked to stop:
// cut off partway, a migration can leave a half-applied schema. It is waited
// for, and killed only once the grace period is over.
func TestStopAllLetsARunningRunOnceStepFinish(t *testing.T) {
	cases := []struct {
		name        string
		finishAfter time.Duration
		wantKill    bool
	}{
		{name: "finishes within the grace period", finishAfter: 5 * time.Second, wantKill: false},
		{name: "never finishes", wantKill: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			step := &scriptedProcess{polite: true}
			supervisor, clock, calls, output := startScriptedServices(t,
				[]Service{{Name: "migrate", Output: "migrate", RunOnce: true}},
				map[string]*scriptedProcess{"migrate": step},
			)
			stopStarted := clock.Now()
			if tc.finishAfter > 0 {
				go func() {
					for clock.Now().Sub(stopStarted) < tc.finishAfter {
						time.Sleep(time.Millisecond)
					}
					step.exit()
				}()
			}

			supervisor.StopAll()

			got, times := calls.snapshot()
			if slices.Contains(got, "migrate:stop") {
				t.Errorf("calls = %v: the running step was asked to stop", got)
			}
			_, killed := times["migrate:kill"]
			if killed != tc.wantKill {
				t.Errorf("calls = %v, want killed %v", got, tc.wantKill)
			}
			if killed && times["migrate:kill"].Sub(stopStarted) < stopGracePeriod {
				t.Errorf("the step was killed after %s, before the %s grace period was over", times["migrate:kill"].Sub(stopStarted), stopGracePeriod)
			}
			if hasEvent(output.events(t), eventError) {
				t.Errorf("events = %v: a step stopped with the engine was reported as failed", summary(output.events(t)))
			}
		})
	}
}
