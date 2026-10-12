package engine

import (
	"context"
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// viewerSource is the expression source `${viewer.*}` reads.
const viewerSource = "viewer"

// ViewerFacts reads the facts of the viewer an event is about, as the
// `${viewer.*}` source sees them.
type ViewerFacts interface {
	// Viewer returns the source's data for event, read through trigger: the
	// event pattern of the registered trigger the workflow listens with,
	// whose emits say which field names the viewer. It returns nil and no
	// error when the event does not name exactly one viewer.
	//
	// It returns an error when it cannot tell who the viewer is or cannot
	// read their facts. The data may then still hold what the event alone
	// says about the viewer. A failure is its own to log.
	Viewer(ctx context.Context, trigger string, event *types.Event) (map[string]any, error)
}

// SetViewerFacts wires the `${viewer.*}` source. Optional: with none set, every
// `${viewer.*}` reference resolves as missing. Set before the engine handles
// its first event.
func (e *Engine[TServices]) SetViewerFacts(facts ViewerFacts) {
	e.viewerFacts = facts
}

// viewerTrigger is the trigger pattern a workflow's `${viewer.*}` is read
// through, or "" for a workflow no event triggers.
func viewerTrigger(wf *types.WorkflowDefinition) string {
	if wf.Trigger == nil || wf.Trigger.Type != "event" {
		return ""
	}
	return wf.Trigger.Event
}

// newViewerLoader returns the loader of the `${viewer.*}` data for event read
// through trigger. It reads at most once, and only when first called, so an
// event no expression asks about costs no read.
func (e *Engine[TServices]) newViewerLoader(trigger string, event *types.Event) expression.LazyLoader {
	return sync.OnceValues(func() (any, error) {
		if e.viewerFacts == nil || trigger == "" || event == nil {
			return nil, nil
		}
		viewer, err := e.viewerFacts.Viewer(e.ctx, trigger, event)
		if err != nil {
			return viewer, fmt.Errorf("viewer facts unavailable: %w", err)
		}
		return viewer, nil
	})
}

// viewerFor returns the loader for wf from loaders, the ones made for event so
// far. Workflows an event starts through the same trigger share one loader:
// their trigger conditions and steps read the viewer's facts once between them.
func (e *Engine[TServices]) viewerFor(loaders map[string]expression.LazyLoader, wf *types.WorkflowDefinition, event *types.Event) expression.LazyLoader {
	trigger := viewerTrigger(wf)
	if loader, ok := loaders[trigger]; ok {
		return loader
	}
	loader := e.newViewerLoader(trigger, event)
	loaders[trigger] = loader
	return loader
}

// runViewer is one run's `${viewer.*}` source.
type runViewer struct {
	trigger string
	event   *types.Event

	mu   sync.Mutex
	load expression.LazyLoader
	// reported is set once a step has logged that load failed, so a run
	// logs it once rather than once per step.
	reported bool
}

func newRunViewer(trigger string, event *types.Event, load expression.LazyLoader) *runViewer {
	if load == nil {
		panic("engine: a run's viewer source needs a loader")
	}
	return &runViewer{trigger: trigger, event: event, load: load}
}

// refreshViewer gives a run a fresh `${viewer.*}` loader, so the steps after a
// pause read the viewer's facts as they are when it resumes rather than as
// they were when it started.
func (e *Engine[TServices]) refreshViewer(executionID string) {
	ctl := e.control(executionID)
	if ctl == nil {
		return
	}
	v := ctl.viewer
	v.mu.Lock()
	defer v.mu.Unlock()
	v.load = e.newViewerLoader(v.trigger, v.event)
	v.reported = false
}

// stepViewer is the `${viewer.*}` loader a run's steps read through. Unlike a
// trigger condition, which refuses to start a run on facts it could not read,
// a step belongs to a run already started: an unreadable source reads as
// missing values, and the run logs it once. A run with no control -- one
// built by hand in a test -- has no viewer.
func (e *Engine[TServices]) stepViewer(execution *types.WorkflowExecution) expression.LazyLoader {
	ctl := e.control(execution.ID)
	if ctl == nil {
		return func() (any, error) { return nil, nil }
	}
	v := ctl.viewer
	v.mu.Lock()
	load := v.load
	v.mu.Unlock()
	return func() (any, error) {
		data, err := load()
		if err == nil {
			return data, nil
		}
		v.mu.Lock()
		first := !v.reported
		v.reported = true
		v.mu.Unlock()
		if first {
			e.logger.Warn("${viewer.*} unavailable; this run's steps read the viewer's facts as missing",
				"workflow", execution.WorkflowID,
				"execution", execution.ID,
				"error", err)
		}
		return data, nil
	}
}

// addViewerSource adds the `${viewer.*}` source to resolver. A step id
// `viewer` shadows the source.
func addViewerSource(resolver *expression.Resolver, viewer expression.LazyLoader, taskExports map[string]map[string]any) {
	if _, shadowed := taskExports[viewerSource]; shadowed {
		return
	}
	resolver.AddLazySource(viewerSource, viewer)
}
