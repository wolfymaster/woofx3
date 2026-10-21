package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const (
	// DefaultRecorderQueueSize is how many captured writes wait for the db
	// proxy before new ones are dropped. A run is a handful of writes, so this
	// covers a burst of a few hundred runs during a short db proxy stall.
	DefaultRecorderQueueSize = 1024
	// DefaultRecorderCallTimeout bounds one history write. Shorter than
	// DefaultDbRequestTimeout so that the writer, not the HTTP client, decides
	// when to give up on a write.
	DefaultRecorderCallTimeout = 3 * time.Second
	// DefaultRecorderDrainTimeout is how long shutdown waits for queued writes
	// after the engine has stopped. With engine.DefaultStopDrainTimeout and
	// engine.DefaultStopSettleTimeout it must fit inside dependentStopPeriod
	// in build/orchestrator/main.go, after which db-proxy is stopped.
	DefaultRecorderDrainTimeout = 500 * time.Millisecond
	// DefaultRecorderDropLogInterval is the least time between two warnings
	// about dropped writes, so a full queue does not flood the log.
	DefaultRecorderDropLogInterval = 1 * time.Second
)

// recorderConfig tunes asyncRunRecorder.
type recorderConfig struct {
	QueueSize       int
	CallTimeout     time.Duration
	DrainTimeout    time.Duration
	DropLogInterval time.Duration
}

func defaultRecorderConfig() recorderConfig {
	return recorderConfig{
		QueueSize:       DefaultRecorderQueueSize,
		CallTimeout:     DefaultRecorderCallTimeout,
		DrainTimeout:    DefaultRecorderDrainTimeout,
		DropLogInterval: DefaultRecorderDropLogInterval,
	}
}

func (c recorderConfig) validate() error {
	if c.QueueSize <= 0 {
		return fmt.Errorf("run recorder queue size must be positive, got %d", c.QueueSize)
	}
	if c.CallTimeout <= 0 {
		return fmt.Errorf("run recorder call timeout must be positive, got %s", c.CallTimeout)
	}
	if c.DrainTimeout <= 0 {
		return fmt.Errorf("run recorder drain timeout must be positive, got %s", c.DrainTimeout)
	}
	if c.DropLogInterval <= 0 {
		return fmt.Errorf("run recorder drop log interval must be positive, got %s", c.DropLogInterval)
	}
	return nil
}

var (
	errRecorderNotStarted = errors.New("run recorder was never started")
	errRecorderStopped    = errors.New("run recorder already stopped")
)

// asyncRunRecorder is the engine's RunRecorder: it captures each write while
// the engine reports it and hands it to one background writer.
//
// The engine reports a run's start on the goroutine that delivered its event,
// and for an ordered workflow that is the bus subscription itself. Writing
// there would let a slow db proxy stall the subscription, so nothing here
// waits on the network: a write is queued, or dropped and counted when the
// queue is full.
//
// One writer applies writes in the order they were queued, which keeps a
// run's row ahead of its steps and its outcome. Run history therefore trails
// the run by however long the queue takes to reach it.
type asyncRunRecorder struct {
	db     *dbRunRecorder
	cfg    recorderConfig
	logger tasks.Logger
	now    func() time.Time

	queue chan runWrite
	// mu orders enqueue against Stop closing the queue: enqueue sends under
	// the read lock, Stop closes under the write lock.
	mu      sync.RWMutex
	started bool
	closed  bool

	// ctx is the writer's own, ended by Stop when the drain runs out of time.
	// It is not the runtime's context: that ends before the application
	// terminates, and the engine records the outcomes of the runs it stops
	// after that.
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}

	dropped atomic.Uint64
	// lastDropLog is the time of the last drop warning, in Unix nanoseconds.
	lastDropLog atomic.Int64
}

var _ engine.RunRecorder = (*asyncRunRecorder)(nil)

func newAsyncRunRecorder(client runStore, cfg recorderConfig, logger tasks.Logger, now func() time.Time) (*asyncRunRecorder, error) {
	if client == nil {
		return nil, errors.New("run recorder needs a run store")
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &asyncRunRecorder{
		db:     newDBRunRecorder(client, logger, cfg.CallTimeout),
		cfg:    cfg,
		logger: logger,
		now:    now,
		queue:  make(chan runWrite, cfg.QueueSize),
		ctx:    ctx,
		cancel: cancel,
		done:   make(chan struct{}),
	}, nil
}

// Start runs the writer. It must be called once, before Stop.
func (r *asyncRunRecorder) Start() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.started {
		panic("run recorder started twice")
	}
	r.started = true
	go r.run()
}

// Stop takes no more writes and waits for the queued ones until ctx ends.
// Writes still queued then are given up on, and the one in flight is
// cancelled; Stop returns once the writer has exited either way.
func (r *asyncRunRecorder) Stop(ctx context.Context) error {
	r.mu.Lock()
	if !r.started {
		r.mu.Unlock()
		return errRecorderNotStarted
	}
	if r.closed {
		r.mu.Unlock()
		return errRecorderStopped
	}
	r.closed = true
	close(r.queue)
	r.mu.Unlock()

	defer r.cancel()
	select {
	case <-r.done:
		return nil
	case <-ctx.Done():
		r.cancel()
		<-r.done
		return fmt.Errorf("run recorder drain cut short: %w", ctx.Err())
	}
}

// Dropped is how many writes were given up on because the queue was full or
// the recorder had stopped.
func (r *asyncRunRecorder) Dropped() uint64 {
	return r.dropped.Load()
}

func (r *asyncRunRecorder) RunStarted(execution *types.WorkflowExecution) {
	r.enqueue(r.db.runStarted(execution))
}

func (r *asyncRunRecorder) RunSettled(execution *types.WorkflowExecution) {
	r.enqueue(r.db.runSettled(execution))
}

func (r *asyncRunRecorder) StepSettled(execution *types.WorkflowExecution, step engine.RunStep) {
	r.enqueue(r.db.stepSettled(execution, step))
}

func (r *asyncRunRecorder) enqueue(w runWrite) {
	if w == nil {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.closed {
		r.drop("recorder stopped")
		return
	}
	select {
	case r.queue <- w:
	default:
		r.drop("queue full")
	}
}

// drop counts a write given up on, and warns at most once per DropLogInterval.
func (r *asyncRunRecorder) drop(reason string) {
	total := r.dropped.Add(1)
	now := r.now().UnixNano()
	last := r.lastDropLog.Load()
	if now-last < r.cfg.DropLogInterval.Nanoseconds() {
		return
	}
	if !r.lastDropLog.CompareAndSwap(last, now) {
		return
	}
	r.logger.Warn("workflow run history dropped",
		"reason", reason,
		"dropped", total,
		"queueSize", r.cfg.QueueSize)
}

// run applies queued writes in order until Stop closes the queue. Once Stop
// has cancelled the writer's context, the rest are counted, not sent.
func (r *asyncRunRecorder) run() {
	defer close(r.done)
	abandoned := 0
	for w := range r.queue {
		if r.ctx.Err() != nil {
			abandoned++
			continue
		}
		r.db.write(r.ctx, w)
	}
	if abandoned > 0 {
		r.dropped.Add(uint64(abandoned))
		r.logger.Warn("workflow run history not written before shutdown", "writes", abandoned)
	}
}
