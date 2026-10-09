package engine

import (
	"context"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// viewerSource is the expression source `${viewer.*}` reads.
const viewerSource = "viewer"

// ViewerFacts reads the facts of the viewer an event is about, as the
// `${viewer.*}` source sees them.
type ViewerFacts interface {
	// Viewer returns the source's data for event, or nil when the event does
	// not name exactly one viewer or the facts cannot be read. It never fails
	// a run: a failure is its own to log, and reads as missing values.
	Viewer(ctx context.Context, event *types.Event) map[string]any
}

// SetViewerFacts wires the `${viewer.*}` source. Optional: with none set, every
// `${viewer.*}` reference resolves as missing. Set before the engine handles
// its first event.
func (e *Engine[TServices]) SetViewerFacts(facts ViewerFacts) {
	e.viewerFacts = facts
}

// viewerLoader returns the loader of the `${viewer.*}` data for event. It reads
// at most once, and only when first called, so an event no expression asks
// about costs no read. Every run an event starts shares one loader: their
// trigger conditions and steps read the viewer's facts once between them.
func (e *Engine[TServices]) viewerLoader(event *types.Event) func() any {
	return sync.OnceValue(func() any {
		if e.viewerFacts == nil || event == nil {
			return nil
		}
		return e.viewerFacts.Viewer(e.ctx, event)
	})
}

// runViewer is the loader a run was begun with. A run with no control -- one
// built by hand in a test -- gets a loader of its own on every call.
func (e *Engine[TServices]) runViewer(execution *types.WorkflowExecution, event *types.Event) func() any {
	if ctl := e.control(execution.ID); ctl != nil {
		return ctl.viewer
	}
	return e.viewerLoader(event)
}

// addViewerSource adds the `${viewer.*}` source to resolver unless a step's
// exports already go by its name: a step id `viewer` keeps resolving to that
// step, as it did before the source existed.
func addViewerSource(resolver *expression.Resolver, viewer func() any, taskExports map[string]map[string]any) {
	if _, shadowed := taskExports[viewerSource]; shadowed {
		return
	}
	resolver.AddLazySource(viewerSource, viewer)
}
