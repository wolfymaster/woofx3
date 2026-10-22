package engine

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const (
	// DefaultRunRetentionTTL is how long a settled run stays in memory. Long
	// enough for a parent resuming from a sub-workflow, or a cancel racing the
	// settle, to still find it; the run's history is in the recorder, not here.
	DefaultRunRetentionTTL = 2 * time.Minute
	// DefaultRunSweepInterval is how often settled runs past their retention
	// are evicted.
	DefaultRunSweepInterval = 30 * time.Second
	// DefaultMaxSettledRuns caps how many settled runs are kept however recent
	// they are, so a burst of events cannot grow memory without bound inside
	// one retention window.
	DefaultMaxSettledRuns = 10_000
)

// RetentionConfig bounds how long the engine keeps runs that have settled.
type RetentionConfig struct {
	RetentionTTL   time.Duration
	SweepInterval  time.Duration
	MaxSettledRuns int
}

func DefaultRetentionConfig() RetentionConfig {
	return RetentionConfig{
		RetentionTTL:   DefaultRunRetentionTTL,
		SweepInterval:  DefaultRunSweepInterval,
		MaxSettledRuns: DefaultMaxSettledRuns,
	}
}

// Validate refuses a value that would disable eviction or spin the sweeper.
func (c RetentionConfig) Validate() error {
	if c.RetentionTTL <= 0 {
		return fmt.Errorf("run retention TTL must be positive, got %s", c.RetentionTTL)
	}
	if c.SweepInterval <= 0 {
		return fmt.Errorf("run sweep interval must be positive, got %s", c.SweepInterval)
	}
	if c.MaxSettledRuns <= 0 {
		return fmt.Errorf("max settled runs must be positive, got %d", c.MaxSettledRuns)
	}
	return nil
}

// runTable is every run the engine holds in memory: its execution and its
// control, kept in one entry so a run is either wholly present or wholly gone.
// Nothing else in the engine reaches into it.
type runTable struct {
	mu   sync.RWMutex
	runs map[string]*runEntry
}

type runEntry struct {
	execution *types.WorkflowExecution
	control   *runControl
	// settledAt is when the run reached its outcome; zero while it has none.
	settledAt time.Time
}

func newRunTable() *runTable {
	return &runTable{runs: make(map[string]*runEntry)}
}

// put adds a new run. An id is a fresh uuid, so a duplicate, or a run with a
// missing half, is a bug in the caller and stops it rather than replacing a
// live run.
func (t *runTable) put(execution *types.WorkflowExecution, control *runControl) {
	if execution == nil || control == nil {
		panic("engine: run table given a run without its execution or control")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, exists := t.runs[execution.ID]; exists {
		panic(fmt.Sprintf("engine: run %s added to the run table twice", execution.ID))
	}
	t.runs[execution.ID] = &runEntry{execution: execution, control: control}
}

// get returns a run's execution and control, or reports that the table has no
// such run: one never begun here, or one already evicted.
func (t *runTable) get(executionID string) (*types.WorkflowExecution, *runControl, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	entry, ok := t.runs[executionID]
	if !ok {
		return nil, nil, false
	}
	return entry.execution, entry.control, true
}

// settle stamps when a run reached its outcome, which starts its retention.
// A run the table does not hold, such as one built by hand in a test, is left
// alone. The first stamp wins, so the retention is never extended.
func (t *runTable) settle(executionID string, at time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	entry, ok := t.runs[executionID]
	if !ok || !entry.settledAt.IsZero() {
		return
	}
	entry.settledAt = at
}

// snapshotUnsettled lists the runs whose control has not claimed an outcome.
// It goes by the claim rather than settledAt, which is stamped a moment later,
// so a run never reads as unsettled after its outcome was decided.
func (t *runTable) snapshotUnsettled() []*abandonedRun {
	t.mu.RLock()
	defer t.mu.RUnlock()
	var unsettled []*abandonedRun
	for _, entry := range t.runs {
		if !entry.control.isSettled() {
			unsettled = append(unsettled, &abandonedRun{execution: entry.execution, control: entry.control})
		}
	}
	return unsettled
}

// sweep evicts settled runs: every one settled at least the retention TTL
// before now, then the oldest settled first while more than MaxSettledRuns
// remain. A run pinned reports true for is kept whatever its age, because
// something still has to read it. It returns how many runs it evicted.
//
// An evicted run's context is cancelled to release it; the run has settled,
// so nothing still running is waiting on that context to decide anything.
func (t *runTable) sweep(now time.Time, retention RetentionConfig, pinned func(executionID string) bool) int {
	t.mu.Lock()
	defer t.mu.Unlock()

	settled := 0
	var evictable []string
	for id, entry := range t.runs {
		if entry.settledAt.IsZero() {
			continue
		}
		settled++
		if !pinned(id) {
			evictable = append(evictable, id)
		}
	}
	sort.Slice(evictable, func(i, j int) bool {
		a, b := t.runs[evictable[i]], t.runs[evictable[j]]
		if !a.settledAt.Equal(b.settledAt) {
			return a.settledAt.Before(b.settledAt)
		}
		return evictable[i] < evictable[j]
	})

	evicted := 0
	for _, id := range evictable {
		expired := now.Sub(t.runs[id].settledAt) >= retention.RetentionTTL
		if !expired && settled-evicted <= retention.MaxSettledRuns {
			break
		}
		t.runs[id].control.cancel()
		delete(t.runs, id)
		evicted++
	}
	return evicted
}
