package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/common/logging"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestAServiceIsLaunchedWithItsDeclaredArguments(t *testing.T) {
	service := Service{Name: "edge", Args: []string{"run", "--config", "Caddyfile.edge"}}

	got := serviceArgv("/app/caddy", service)

	want := []string{"/app/caddy", "run", "--config", "Caddyfile.edge"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("argv = %v, want %v", got, want)
	}
}

func TestAServiceWithoutArgumentsGetsOnlyItsPath(t *testing.T) {
	got := serviceArgv("/app/api", Service{Name: "api"})

	if !reflect.DeepEqual(got, []string{"/app/api"}) {
		t.Fatalf("argv = %v, want just the binary path", got)
	}
}

func TestAPrebuiltBinaryThatIsNotInstalledIsSkipped(t *testing.T) {
	baseDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(baseDir, "api"), []byte{}, 0o755); err != nil {
		t.Fatalf("write api: %v", err)
	}
	config := &Config{Services: []Service{
		{Name: "api", Type: "bun", Output: "api", Enabled: true},
		{Name: "edge", Type: "binary", Output: "caddy", Enabled: true},
		{Name: "off", Type: "bun", Output: "off", Enabled: false},
	}}

	got := servicesToRun(baseDir, config, discardLogger(), nil)

	names := make([]string, 0, len(got))
	for _, service := range got {
		names = append(names, service.Name)
	}
	if !reflect.DeepEqual(names, []string{"api"}) {
		t.Fatalf("services to run = %v, want [api]: an absent prebuilt binary is skipped", names)
	}
}

func TestAPrebuiltBinaryThatIsInstalledRuns(t *testing.T) {
	baseDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(baseDir, "caddy"), []byte{}, 0o755); err != nil {
		t.Fatalf("write caddy: %v", err)
	}
	config := &Config{Services: []Service{{Name: "edge", Type: "binary", Output: "caddy", Enabled: true}}}

	got := servicesToRun(baseDir, config, discardLogger(), nil)

	if len(got) != 1 || got[0].Name != "edge" {
		t.Fatalf("services to run = %v, want [edge]", got)
	}
}

// A service that takes a while to shut down, as db-proxy does while it
// flushes module storage, is waited for rather than killed mid-shutdown.
func TestStopAllWaitsForAServiceToExitAfterSIGTERM(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("windows cannot deliver SIGTERM")
	}
	marker := filepath.Join(t.TempDir(), "exited-cleanly")
	script := `trap 'sleep 1; touch "$0"; exit 0' TERM; while true; do sleep 0.05; done`

	supervisor := NewSupervisor(t.TempDir(), discardLogger())
	supervisor.AddService(Service{Name: "slow", Args: []string{"-c", script, marker}})
	if err := supervisor.startServiceProcess(supervisor.services["slow"], "/bin/sh"); err != nil {
		t.Fatalf("start: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	started := time.Now()
	supervisor.StopAll()

	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("service was killed before it finished shutting down: %v", err)
	}
	if elapsed := time.Since(started); elapsed > stopGracePeriod/2 {
		t.Errorf("StopAll took %s for a service that exited in about 1s", elapsed)
	}
}

// A service that depends on another is still shutting down when it needs that
// other one: the one depended on must not be asked to stop until it is done.
func TestStopAllStopsDependentsBeforeWhatTheyDependOn(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("windows cannot deliver SIGTERM")
	}
	directory := t.TempDir()
	dependentExited := filepath.Join(directory, "dependent-exited")
	stoppedInOrder := filepath.Join(directory, "stopped-in-order")
	dependentScript := `trap 'sleep 1; touch "$0"; exit 0' TERM; while true; do sleep 0.05; done`
	// Records, at the moment it is asked to stop, whether the dependent had
	// already finished.
	foundationScript := `trap '[ -f "$0" ] && touch "$1"; exit 0' TERM; while true; do sleep 0.05; done`

	supervisor := NewSupervisor(t.TempDir(), discardLogger())
	supervisor.AddService(Service{Name: "foundation", Args: []string{"-c", foundationScript, dependentExited, stoppedInOrder}})
	supervisor.AddService(Service{
		Name:         "dependent",
		Args:         []string{"-c", dependentScript, dependentExited},
		Dependencies: []string{"foundation"},
	})
	for _, name := range []string{"foundation", "dependent"} {
		if err := supervisor.startServiceProcess(supervisor.services[name], "/bin/sh"); err != nil {
			t.Fatalf("start %s: %v", name, err)
		}
	}
	time.Sleep(200 * time.Millisecond)

	started := time.Now()
	supervisor.StopAll()

	if _, err := os.Stat(stoppedInOrder); err != nil {
		t.Fatalf("the foundation was asked to stop before its dependent had exited: %v", err)
	}
	if elapsed := time.Since(started); elapsed > dependentStopPeriod {
		t.Errorf("StopAll took %s: it waited out the dependents' whole share although they exited in about 1s", elapsed)
	}
}

// fakeClock moves forward by whatever its sleepers ask for, so the
// supervisor's one-second polling runs in milliseconds. Every sleeper moves
// the same clock, so it only ever runs ahead; the tests assert what happens,
// and in which order, not exactly when.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Sleep(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
	time.Sleep(time.Millisecond)
}

// fakeProcess runs until it is signalled or killed.
type fakeProcess struct {
	pid    int
	exited chan struct{}
	once   sync.Once
}

func (p *fakeProcess) Pid() int { return p.pid }

func (p *fakeProcess) Signal(os.Signal) error {
	p.exit()
	return nil
}

func (p *fakeProcess) Kill() error {
	p.exit()
	return nil
}

func (p *fakeProcess) Wait() (string, error) {
	<-p.exited
	return "exit status 0", nil
}

func (p *fakeProcess) exit() {
	p.once.Do(func() { close(p.exited) })
}

// fakeProcesses starts fakeProcess values and remembers the order services
// were started in.
type fakeProcesses struct {
	mu      sync.Mutex
	nextPid int
	started []string
	attrs   map[string]*os.ProcAttr
}

func (f *fakeProcesses) start(path string, argv []string, attr *os.ProcAttr) (serviceHandle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextPid++
	name := filepath.Base(path)
	f.started = append(f.started, name)
	if f.attrs == nil {
		f.attrs = make(map[string]*os.ProcAttr)
	}
	f.attrs[name] = attr
	return &fakeProcess{pid: f.nextPid, exited: make(chan struct{})}, nil
}

func (f *fakeProcesses) startedServices() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.started...)
}

// syncBuffer is a bytes.Buffer safe to read while the supervisor writes.
type syncBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

func (b *syncBuffer) events(t *testing.T) []statusEvent {
	t.Helper()
	b.mu.Lock()
	defer b.mu.Unlock()
	var events []statusEvent
	for _, line := range strings.Split(strings.TrimSpace(b.buffer.String()), "\n") {
		if line == "" {
			continue
		}
		var event statusEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("status line %q is not JSON: %v", line, err)
		}
		events = append(events, event)
	}
	return events
}

// summary renders events as "event[:name:status]" for comparison.
func summary(events []statusEvent) []string {
	out := make([]string, 0, len(events))
	for _, event := range events {
		if event.Event == eventService {
			out = append(out, event.Event+":"+event.Name+":"+event.Status)
		} else {
			out = append(out, event.Event)
		}
	}
	return out
}

func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func hasEvent(events []statusEvent, kind string) bool {
	for _, event := range events {
		if event.Event == kind {
			return true
		}
	}
	return false
}

// newFakeSupervisor is a supervisor of fake processes on a fake clock, whose
// binaries exist so the start path is the real one.
func newFakeSupervisor(t *testing.T, services []Service, healthy func(endpoint string) bool) (*Supervisor, *fakeProcesses, *syncBuffer) {
	t.Helper()
	baseDir := t.TempDir()
	clock := newFakeClock()
	output := &syncBuffer{}
	reporter, err := newStatusReporter(supervisionOptions{statusToStdout: true}, output, clock, discardLogger())
	if err != nil {
		t.Fatalf("reporter: %v", err)
	}
	processes := &fakeProcesses{}

	supervisor := NewSupervisor(baseDir, discardLogger())
	supervisor.clock = clock
	supervisor.startProcess = processes.start
	supervisor.checkHealth = healthy
	supervisor.reporter = reporter
	for _, service := range services {
		if err := os.WriteFile(filepath.Join(baseDir, binaryFileName(service)), []byte{}, 0o755); err != nil {
			t.Fatalf("write %s: %v", service.Name, err)
		}
		supervisor.AddService(service)
	}
	return supervisor, processes, output
}

func TestReadyIsReportedOnceEveryServiceIsHealthy(t *testing.T) {
	var checks atomic.Int32
	// The api's health endpoint fails a few times before it passes, as /ready
	// does until the services behind it are up.
	healthy := func(endpoint string) bool {
		if endpoint != "http://127.0.0.1:5050/ready" {
			t.Errorf("health checked at %q", endpoint)
		}
		return checks.Add(1) > 3
	}
	supervisor, processes, output := newFakeSupervisor(t, []Service{
		{Name: "bus", Output: "bus"},
		{Name: "api", Output: "api", Dependencies: []string{"bus"}, HealthEndpoint: "http://127.0.0.1:5050/ready"},
		{Name: "edge", Output: "edge", Dependencies: []string{"api"}},
	}, healthy)

	order, err := supervisor.GetStartupOrder()
	if err != nil {
		t.Fatalf("startup order: %v", err)
	}
	supervisor.StartInOrder(order)
	waitFor(t, "ready", func() bool { return hasEvent(output.events(t), eventReady) })

	supervisor.StopAll()
	supervisor.reporter.stopped()

	if got := processes.startedServices(); !reflect.DeepEqual(got, []string{"bus", "api", "edge"}) {
		t.Errorf("started %v, want dependency order", got)
	}
	got := summary(output.events(t))
	wantPrefix := []string{
		"service:bus:starting", "service:bus:healthy",
		"service:api:starting", "service:api:healthy",
		"service:edge:starting", "service:edge:healthy",
		"ready",
	}
	if len(got) < len(wantPrefix) || !reflect.DeepEqual(got[:len(wantPrefix)], wantPrefix) {
		t.Fatalf("events = %v, want them to start with %v", got, wantPrefix)
	}
	rest := got[len(wantPrefix):]
	if rest[len(rest)-1] != eventStopped {
		t.Errorf("last event = %q, want stopped", rest[len(rest)-1])
	}
	stoppedServices := 0
	for _, event := range rest {
		if event == eventReady {
			t.Errorf("ready reported twice: %v", got)
		}
		if strings.HasSuffix(event, ":stopped") {
			stoppedServices++
		}
	}
	if stoppedServices != 3 {
		t.Errorf("events after ready = %v, want each service reported stopped", rest)
	}
}

func TestAServiceThatNeverPassesItsHealthCheckIsReportedUnhealthyAndTheEngineNeverReady(t *testing.T) {
	supervisor, processes, output := newFakeSupervisor(t, []Service{
		{Name: "api", Output: "api", HealthEndpoint: "http://127.0.0.1:5050/ready"},
	}, func(string) bool { return false })

	supervisor.StartInOrder([]string{"api"})
	waitFor(t, "unhealthy", func() bool {
		for _, event := range output.events(t) {
			if event.Event == eventService && event.Status == "unhealthy" {
				return true
			}
		}
		return false
	})
	supervisor.StopAll()

	events := output.events(t)
	if hasEvent(events, eventReady) {
		t.Errorf("ready reported for an unhealthy engine: %v", summary(events))
	}
	if got := processes.startedServices(); !reflect.DeepEqual(got, []string{"api"}) {
		t.Errorf("started %v", got)
	}
	unhealthyAt, startedAt := time.Time{}, time.Time{}
	for _, event := range events {
		at, err := time.Parse(time.RFC3339Nano, event.Time)
		if err != nil {
			t.Fatalf("event time %q: %v", event.Time, err)
		}
		switch event.Status {
		case "starting":
			startedAt = at
		case "unhealthy":
			unhealthyAt = at
		}
	}
	if waited := unhealthyAt.Sub(startedAt); waited <= healthCheckTimeout {
		t.Errorf("reported unhealthy %s after starting, want after the %s timeout", waited, healthCheckTimeout)
	}
}

func TestAServiceThatCannotStartIsReportedAsAnError(t *testing.T) {
	supervisor, _, output := newFakeSupervisor(t, []Service{{Name: "api", Output: "api"}}, func(string) bool { return true })
	supervisor.startProcess = func(string, []string, *os.ProcAttr) (serviceHandle, error) {
		return nil, errors.New("exec format error")
	}

	supervisor.StartInOrder([]string{"api"})
	waitFor(t, "error", func() bool { return hasEvent(output.events(t), eventError) })

	for _, event := range output.events(t) {
		if event.Event == eventError {
			if event.Name != "api" || !strings.Contains(event.Message, "exec format error") {
				t.Errorf("error event = %+v", event)
			}
		}
	}
}

func TestStatusLinesAreJSONWithTheEventTime(t *testing.T) {
	clock := newFakeClock()
	var output bytes.Buffer
	reporter, err := newStatusReporter(supervisionOptions{statusToStdout: true}, &output, clock, discardLogger())
	if err != nil {
		t.Fatalf("reporter: %v", err)
	}

	reporter.service("api", StatusHealthy, 42, "")
	reporter.skipped("edge", "prebuilt binary not installed")
	reporter.ready()
	reporter.failure("", "services.json not found")
	reporter.stopped()

	want := strings.Join([]string{
		`{"event":"service","time":"2026-01-02T03:04:05Z","name":"api","status":"healthy","pid":42}`,
		`{"event":"service","time":"2026-01-02T03:04:05Z","name":"edge","status":"skipped","message":"prebuilt binary not installed"}`,
		`{"event":"ready","time":"2026-01-02T03:04:05Z"}`,
		`{"event":"error","time":"2026-01-02T03:04:05Z","message":"services.json not found"}`,
		`{"event":"stopped","time":"2026-01-02T03:04:05Z"}`,
	}, "\n") + "\n"
	if output.String() != want {
		t.Errorf("status output:\n%s\nwant:\n%s", output.String(), want)
	}
}

func TestStatusGoesToBothStdoutAndTheStatusFile(t *testing.T) {
	statusFile := filepath.Join(t.TempDir(), "run", "status.jsonl")
	var stdout bytes.Buffer
	reporter, err := newStatusReporter(supervisionOptions{statusToStdout: true, statusFile: statusFile}, &stdout, newFakeClock(), discardLogger())
	if err != nil {
		t.Fatalf("reporter: %v", err)
	}

	reporter.ready()
	reporter.Close()

	written, err := os.ReadFile(statusFile)
	if err != nil {
		t.Fatalf("read status file: %v", err)
	}
	if string(written) != stdout.String() || !strings.Contains(stdout.String(), `"event":"ready"`) {
		t.Errorf("status file %q, stdout %q: want the same ready line in both", written, stdout.String())
	}
}

func TestWithoutSupervisionOptionsNothingIsReported(t *testing.T) {
	reporter, err := newStatusReporter(supervisionOptions{}, os.Stdout, newFakeClock(), discardLogger())
	if err != nil || reporter != nil {
		t.Fatalf("reporter = %v, %v; want none", reporter, err)
	}
	// A nil reporter is what the supervisor holds then, and must be inert.
	reporter.service("api", StatusHealthy, 1, "")
	reporter.ready()
	reporter.stopped()
	reporter.failure("api", "x")
	reporter.Close()
}

func TestParseSupervisionOptions(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}

	cases := []struct {
		name string
		args []string
		env  map[string]string
		want supervisionOptions
	}{
		{name: "nothing set", want: supervisionOptions{}},
		{name: "stdout", env: map[string]string{statusModeEnv: "stdout-jsonl"}, want: supervisionOptions{statusToStdout: true}},
		{name: "file", args: []string{"--status-file", "/run/woofx3/status.jsonl"}, want: supervisionOptions{statusFile: "/run/woofx3/status.jsonl"}},
		{name: "stdin", args: []string{"--exit-on-stdin-eof"}, want: supervisionOptions{exitOnStdinEOF: true}},
		{
			name: "all",
			args: []string{"--status-file=status.jsonl", "--exit-on-stdin-eof"},
			env:  map[string]string{statusModeEnv: "stdout-jsonl"},
			want: supervisionOptions{statusToStdout: true, statusFile: "status.jsonl", exitOnStdinEOF: true},
		},
	}
	for _, tc := range cases {
		got, err := parseSupervisionOptions(tc.args, env(tc.env))
		if err != nil {
			t.Errorf("%s: %v", tc.name, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%s: options = %+v, want %+v", tc.name, got, tc.want)
		}
	}

	if _, err := parseSupervisionOptions(nil, env(map[string]string{statusModeEnv: "stdout"})); err == nil {
		t.Error("an unknown status mode was accepted")
	}
	if _, err := parseSupervisionOptions([]string{"--status"}, env(nil)); err == nil {
		t.Error("an unknown flag was accepted")
	}
}

func TestServicesShareTheOrchestratorStdioByDefault(t *testing.T) {
	supervisor := NewSupervisor(t.TempDir(), discardLogger())

	files, closeFiles, err := supervisor.childFiles("api")
	if err != nil {
		t.Fatalf("childFiles: %v", err)
	}
	defer closeFiles()

	if !reflect.DeepEqual(files, []*os.File{os.Stdin, os.Stdout, os.Stderr}) {
		t.Errorf("files = %v, want the orchestrator's own stdio", files)
	}
}

func TestServiceOutputGoesToItsOwnFileWhenStdoutCarriesStatus(t *testing.T) {
	baseDir := t.TempDir()
	dataDir := t.TempDir()
	t.Setenv("WOOFX3_DATA_DIR", dataDir)
	t.Setenv("WOOFX3_LOG_DIR", "")
	devNull, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatalf("open %s: %v", os.DevNull, err)
	}
	defer devNull.Close()

	supervisor := NewSupervisor(baseDir, discardLogger())
	// As main sets it up: the orchestrator's own log directory, which the
	// data directory relocates.
	supervisor.childOutputDirectory = logging.ResolveLogDirectory(filepath.Join(baseDir, "logs"))
	supervisor.childStdin = devNull

	files, closeFiles, err := supervisor.childFiles("api")
	if err != nil {
		t.Fatalf("childFiles: %v", err)
	}
	if _, err := files[1].WriteString("listening\n"); err != nil {
		t.Fatalf("write: %v", err)
	}
	closeFiles()

	if files[0] != devNull {
		t.Errorf("stdin = %v, want the null device", files[0])
	}
	if files[1] != files[2] {
		t.Errorf("stdout and stderr go to different files")
	}
	written, err := os.ReadFile(filepath.Join(dataDir, "logs", "api.output.log"))
	if err != nil {
		t.Fatalf("read service output: %v", err)
	}
	if string(written) != "listening\n" {
		t.Errorf("service output = %q", written)
	}
}

func TestWaitForEOFReturnsWhenTheParentClosesStdin(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	defer reader.Close()

	returned := make(chan struct{})
	go func() {
		waitForEOF(reader)
		close(returned)
	}()

	writer.WriteString("anything the parent writes is ignored\n")
	select {
	case <-returned:
		t.Fatal("returned before stdin closed")
	case <-time.After(50 * time.Millisecond):
	}

	writer.Close()
	select {
	case <-returned:
	case <-time.After(5 * time.Second):
		t.Fatal("did not return after stdin closed")
	}
}

func TestBinaryFileNameFollowsTheBuildTarget(t *testing.T) {
	// A Windows process without OS=Windows_NT in its environment, started by
	// a parent that cleared it, still runs the .exe services.
	t.Setenv("OS", "")

	got := binaryFileName(Service{Output: "api"})

	want := "api"
	if runtime.GOOS == "windows" {
		want = "api.exe"
	}
	if got != want {
		t.Errorf("binaryFileName = %q, want %q on %s", got, want, runtime.GOOS)
	}
}
