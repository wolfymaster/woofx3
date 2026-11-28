package engine

import (
	"context"

	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const (
	traceparentKey = "traceparent"
	tracestateKey  = "tracestate"
)

// eventCarrier reads the trace context an event carries.
func eventCarrier(event *types.Event) propagation.MapCarrier {
	carrier := propagation.MapCarrier{}
	if event == nil {
		return carrier
	}
	if event.TraceParent != "" {
		carrier[traceparentKey] = event.TraceParent
	}
	if event.TraceState != "" {
		carrier[tracestateKey] = event.TraceState
	}
	return carrier
}

// extractEventTrace returns ctx carrying the trace context of event, or ctx
// itself when the event has none or it is malformed.
func extractEventTrace(ctx context.Context, event *types.Event) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, eventCarrier(event))
}

// stampTrace sets the trace context of ctx on event, so it travels with the
// event when it is published.
func stampTrace(ctx context.Context, event *types.Event) {
	if ctx == nil {
		return
	}
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	event.TraceParent = carrier[traceparentKey]
	event.TraceState = carrier[tracestateKey]
}

// beginSegment records sc as the span the run's steps are children of. A run
// is a chain of segments: one from its trigger, and one after each pause. The
// first is kept as the run's origin, which later segments link to.
func (c *runControl) beginSegment(sc trace.SpanContext) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.segment = sc
	if !c.origin.IsValid() {
		c.origin = sc
	}
}

func (c *runControl) traceSpans() (segment, origin trace.SpanContext) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.segment, c.origin
}

// traceContext is the context the run's steps and events are children of: its
// current segment, or, before one has begun, the trigger event's own context.
func (e *Engine[TServices]) traceContext(executionID string, event *types.Event) context.Context {
	base := e.runContext(executionID)
	if ctl := e.control(executionID); ctl != nil {
		if segment, _ := ctl.traceSpans(); segment.IsValid() {
			return trace.ContextWithSpanContext(base, segment)
		}
	}
	return extractEventTrace(base, event)
}

// beginRunSegment starts the span for a run's first stretch of steps, as a
// child of the event that triggered it.
func (e *Engine[TServices]) beginRunSegment(execution *types.WorkflowExecution, event *types.Event) trace.Span {
	_, span := logging.StartSpan(extractEventTrace(e.runContext(execution.ID), event), "workflow.execute",
		attribute.String("workflow.id", execution.WorkflowID),
		attribute.String("workflow.execution_id", execution.ID),
	)
	if ctl := e.control(execution.ID); ctl != nil {
		ctl.beginSegment(span.SpanContext())
	}
	return span
}

// beginResumedSegment starts the span for the steps after a pause. The span
// that was the run's parent ended long ago, so it is a new root linked to the
// run's origin instead of a child of it.
func (e *Engine[TServices]) beginResumedSegment(execution *types.WorkflowExecution) trace.Span {
	options := []trace.SpanStartOption{
		trace.WithAttributes(
			attribute.String("workflow.id", execution.WorkflowID),
			attribute.String("workflow.execution_id", execution.ID),
		),
	}
	ctl := e.control(execution.ID)
	if ctl != nil {
		if _, origin := ctl.traceSpans(); origin.IsValid() {
			options = append(options, trace.WithNewRoot(), trace.WithLinks(trace.Link{SpanContext: origin}))
		}
	}
	_, span := logging.StartSpanWith(e.runContext(execution.ID), "workflow.resume", options...)
	if ctl != nil {
		ctl.beginSegment(span.SpanContext())
	}
	return span
}

// startStepSpan starts the span for one step, a child of the run's current
// segment, and returns the context the step runs under.
func (e *Engine[TServices]) startStepSpan(execution *types.WorkflowExecution, taskDef *types.TaskDefinition, event *types.Event) (context.Context, trace.Span) {
	return logging.StartSpan(e.traceContext(execution.ID, event), "workflow.task",
		attribute.String("workflow.id", execution.WorkflowID),
		attribute.String("workflow.execution_id", execution.ID),
		attribute.String("workflow.task_id", taskDef.ID),
		attribute.String("workflow.task_action", taskDef.Action),
	)
}
