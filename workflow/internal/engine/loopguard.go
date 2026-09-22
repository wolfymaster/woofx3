package engine

import (
	"fmt"
	"strings"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// MaxWorkflowChain is how many workflow runs may lead, one causing the next,
// to the run about to start. Past it the run is refused.
//
// Why a length and not "this workflow is already in the chain": one workflow
// per event is how the dashboard stores triggers, with a condition per
// instance, so "when counter A changes, add to counter B" and "when counter B
// changes, say so in chat" are two branches of the same workflow. That chain
// legitimately visits the workflow twice. A loop is a chain that never ends,
// and the only thing every loop does is grow. Eight is far past any chain
// that means to end -- the longest built on purpose is a handful of hops --
// and bounds what a loop can do (chat messages sent, values changed) before
// it is stopped.
const MaxWorkflowChain = 8

// LoopError is a run refused because the chain of runs leading to it is too
// long. Path is that chain with the refused workflow on the end, as workflow
// names where they are known.
type LoopError struct {
	Path []string
	// Cycle is the part of Path that repeats, from the refused workflow's
	// earlier appearance to itself. Empty when the refused workflow does not
	// appear earlier -- a chain can be long without closing on the workflow
	// that happens to be last.
	Cycle []string
}

func (e *LoopError) Error() string {
	if len(e.Cycle) > 0 {
		return fmt.Sprintf(
			"stopped a workflow loop: %s keeps triggering itself (%s), %d runs deep",
			e.Cycle[0], strings.Join(e.Cycle, " → "), len(e.Path)-1)
	}
	return fmt.Sprintf(
		"stopped a chain of %d workflow runs, each triggered by the last: %s",
		len(e.Path)-1, strings.Join(e.Path, " → "))
}

// checkWorkflowChain refuses a run of `workflowID` for `event` when the runs
// that led to the event already number MaxWorkflowChain. `name` turns a
// workflow id into what the error shows.
func checkWorkflowChain(event *types.Event, workflowID string, name func(string) string) error {
	chain := event.Chain()
	if len(chain) < MaxWorkflowChain {
		return nil
	}
	ids := append(append([]string{}, chain...), workflowID)
	path := make([]string, len(ids))
	for i, id := range ids {
		path[i] = name(id)
	}
	loop := &LoopError{Path: path}
	for i := len(chain) - 1; i >= 0; i-- {
		if chain[i] == workflowID {
			loop.Cycle = path[i:]
			break
		}
	}
	return loop
}
