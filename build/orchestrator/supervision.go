package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// statusModeEnv selects where machine-readable status goes. A desktop shell
// that starts the orchestrator reads it to show progress and to know when the
// engine can take requests.
const statusModeEnv = "WOOFX3_SUPERVISOR_STATUS"

// statusModeStdoutJSONL writes status as JSON lines on stdout. Stdout then
// carries nothing else: the orchestrator logs to its file only, and each
// service's output goes to its own file in the log directory.
const statusModeStdoutJSONL = "stdout-jsonl"

// supervisionOptions are the opt-in supervision features. The zero value is
// the orchestrator run by hand or by a container: no status, services share
// the orchestrator's stdio, and only a signal stops it.
type supervisionOptions struct {
	statusToStdout bool
	statusFile     string
	exitOnStdinEOF bool
}

// parseSupervisionOptions reads the supervision flags and statusModeEnv.
func parseSupervisionOptions(args []string, getenv func(string) string) (supervisionOptions, error) {
	var options supervisionOptions

	flags := flag.NewFlagSet("orchestrator", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.statusFile, "status-file", "", "append status as JSON lines to this file")
	flags.BoolVar(&options.exitOnStdinEOF, "exit-on-stdin-eof", false, "stop the services and exit when stdin closes")
	if err := flags.Parse(args); err != nil {
		return supervisionOptions{}, err
	}
	if flags.NArg() > 0 {
		return supervisionOptions{}, fmt.Errorf("unexpected arguments: %v", flags.Args())
	}

	switch mode := getenv(statusModeEnv); mode {
	case "":
	case statusModeStdoutJSONL:
		options.statusToStdout = true
	default:
		return supervisionOptions{}, fmt.Errorf("%s=%q is not supported (supported: %s)", statusModeEnv, mode, statusModeStdoutJSONL)
	}

	return options, nil
}

// Status events. A consumer must ignore event types, service statuses and
// fields it does not know, so that more can be added.
const (
	eventService = "service"
	eventReady   = "ready"
	eventStopped = "stopped"
	eventError   = "error"
)

type statusEvent struct {
	Event   string `json:"event"`
	Time    string `json:"time"`
	Name    string `json:"name,omitempty"`
	Status  string `json:"status,omitempty"`
	PID     int    `json:"pid,omitempty"`
	Message string `json:"message,omitempty"`
}

// statusReporter writes status events as JSON lines. A nil reporter, or one
// without writers, reports nothing, so the supervisor reports unconditionally.
type statusReporter struct {
	mu      sync.Mutex
	writers []io.Writer
	closers []io.Closer
	clock   clock
	logger  *slog.Logger
	// writeFailed keeps a broken writer from logging a warning per event.
	writeFailed bool
}

// newStatusReporter opens the destinations the options ask for. It returns nil
// when they ask for none.
func newStatusReporter(options supervisionOptions, stdout io.Writer, clock clock, logger *slog.Logger) (*statusReporter, error) {
	if !options.statusToStdout && options.statusFile == "" {
		return nil, nil
	}
	reporter := &statusReporter{clock: clock, logger: logger}
	if options.statusToStdout {
		reporter.writers = append(reporter.writers, stdout)
	}
	if options.statusFile != "" {
		if err := os.MkdirAll(filepath.Dir(options.statusFile), 0o755); err != nil {
			return nil, fmt.Errorf("create status file directory: %w", err)
		}
		file, err := os.OpenFile(options.statusFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return nil, fmt.Errorf("open status file: %w", err)
		}
		reporter.writers = append(reporter.writers, file)
		reporter.closers = append(reporter.closers, file)
	}
	return reporter, nil
}

func (r *statusReporter) service(name string, status ServiceStatus, pid int, message string) {
	r.emit(statusEvent{Event: eventService, Name: name, Status: status.String(), PID: pid, Message: message})
}

func (r *statusReporter) ready() {
	r.emit(statusEvent{Event: eventReady})
}

func (r *statusReporter) stopped() {
	r.emit(statusEvent{Event: eventStopped})
}

// failure reports an error, about one service when name is set and about the
// orchestrator otherwise.
func (r *statusReporter) failure(name string, message string) {
	r.emit(statusEvent{Event: eventError, Name: name, Message: message})
}

func (r *statusReporter) emit(event statusEvent) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.writers) == 0 {
		return
	}

	event.Time = r.clock.Now().UTC().Format(time.RFC3339Nano)
	line, err := json.Marshal(event)
	if err != nil {
		panic(fmt.Sprintf("status event does not marshal: %v", err))
	}
	line = append(line, '\n')

	var failures []error
	for _, writer := range r.writers {
		if _, err := writer.Write(line); err != nil {
			failures = append(failures, err)
		}
	}
	if len(failures) > 0 && !r.writeFailed {
		r.writeFailed = true
		r.logger.Warn("Could not write supervisor status", "error", errors.Join(failures...))
	}
}

func (r *statusReporter) Close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, closer := range r.closers {
		if err := closer.Close(); err != nil {
			r.logger.Warn("Could not close the status output", "error", err)
		}
	}
	r.closers = nil
	r.writers = nil
}

// waitForEOF returns once reader is closed, or with the error that ended the
// read. The orchestrator's parent holds the other end of its stdin, so EOF
// means the parent has gone, even when it was killed without a chance to stop
// the orchestrator.
func waitForEOF(reader io.Reader) error {
	_, err := io.Copy(io.Discard, reader)
	return err
}

// childOutputFileName is the file in the log directory that receives a
// service's stdout and stderr when the orchestrator's stdout is not theirs.
func childOutputFileName(serviceName string) string {
	return serviceName + ".output.log"
}

// clock is the time source of the supervisor's polling, so tests can run its
// loops without waiting on the wall clock.
type clock interface {
	Now() time.Time
	// Sleep waits for d, or until ctx is done, and returns ctx's error in
	// that case.
	Sleep(ctx context.Context, d time.Duration) error
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

func (systemClock) Sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// serviceHandle is a started service process.
type serviceHandle interface {
	Pid() int
	// RequestStop asks the process to shut down gracefully. It returns once
	// the request is delivered, not once the process has exited.
	RequestStop() error
	Kill() error
	// Wait blocks until the process exits and says how it did.
	Wait() (processExit, error)
}

// processExit is how a service process ended.
type processExit struct {
	// description is the exit as the OS reports it, such as "exit status 1".
	description string
	// success is an exit with status 0.
	success bool
}

// processStarter starts a service process.
type processStarter func(path string, argv []string, attr *os.ProcAttr) (serviceHandle, error)

// osProcess is a service process started by startOSProcess. How it is started
// and asked to stop depends on the platform: see process_windows.go and
// process_other.go.
type osProcess struct {
	process *os.Process
}

func (p osProcess) Pid() int    { return p.process.Pid }
func (p osProcess) Kill() error { return p.process.Kill() }

func (p osProcess) Wait() (processExit, error) {
	state, err := p.process.Wait()
	if err != nil {
		return processExit{}, err
	}
	return processExit{description: state.String(), success: state.Success()}, nil
}
