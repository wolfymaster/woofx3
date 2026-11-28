package engine

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

const testTraceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"

func installTestTracer(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})
	return exporter
}

func spansNamed(exporter *tracetest.InMemoryExporter, name string) []tracetest.SpanStub {
	var found []tracetest.SpanStub
	for _, stub := range exporter.GetSpans() {
		if stub.Name == name {
			found = append(found, stub)
		}
	}
	return found
}

// Steps run under the trace of the event that triggered the run, and steps
// after a wait start a new trace linked to it: the span they were once
// children of has long ended.
func TestRunStepsFollowTheTriggerAndResumedStepsLinkToIt(t *testing.T) {
	exporter := installTestTracer(t)
	h := newWaitHarness(t)
	def := &types.WorkflowDefinition{
		ID:      "wf-trace",
		Name:    "trace",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.raid"},
		Tasks: []types.TaskDefinition{
			{ID: "before", Type: "action", Action: "mark", Parameters: map[string]any{"id": "before"}},
			{ID: "pause", Type: "wait", DependsOn: []string{"before"}, Wait: eventWait(20*time.Millisecond, tasks.OnTimeoutContinue)},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"pause"}, Parameters: map[string]any{"id": "after"}},
		},
	}
	trigger := &types.Event{
		ID: "raid-1", Type: "channel.raid", Source: "test", Time: time.Now(), Data: map[string]any{},
		TraceParent: testTraceparent,
	}
	h.engine.startRun(def, trigger, h.engine.newViewerLoader(viewerTrigger(def), trigger))
	h.recorder.awaitSettled(t, 2*time.Second)

	triggerTrace := trace.SpanContextFromContext(extractEventTrace(t.Context(), trigger)).TraceID()
	steps := spansNamed(exporter, "workflow.task")
	byTask := map[string]tracetest.SpanStub{}
	for _, step := range steps {
		for _, attr := range step.Attributes {
			if attr.Key == "workflow.task_id" {
				byTask[attr.Value.AsString()] = step
			}
		}
	}

	if got := byTask["before"].SpanContext.TraceID(); got != triggerTrace {
		t.Fatalf("step before the wait is in trace %s, want the trigger's %s", got, triggerTrace)
	}
	if got := spansNamed(exporter, "workflow.execute"); len(got) != 1 || got[0].Parent.TraceID() != triggerTrace {
		t.Fatalf("run span should be a child of the trigger: %+v", got)
	}

	resumed := spansNamed(exporter, "workflow.resume")
	if len(resumed) != 1 {
		t.Fatalf("want one resume span, got %d", len(resumed))
	}
	if resumed[0].SpanContext.TraceID() == triggerTrace || resumed[0].Parent.IsValid() {
		t.Fatalf("resume span should be a new root, got %+v", resumed[0])
	}
	if len(resumed[0].Links) != 1 || resumed[0].Links[0].SpanContext.TraceID() != triggerTrace {
		t.Fatalf("resume span should link to the originating trace, got %+v", resumed[0].Links)
	}
	if got := byTask["after"].Parent.SpanID(); got != resumed[0].SpanContext.SpanID() {
		t.Fatalf("step after the wait is not under the resume span")
	}
}

func TestRunWithoutTraceparentStartsANewRoot(t *testing.T) {
	exporter := installTestTracer(t)
	h := newDisabledHarness(t)
	h.run([]*types.TaskDefinition{markTask("only")})

	steps := spansNamed(exporter, "workflow.task")
	if len(steps) != 1 || !steps[0].SpanContext.TraceID().IsValid() {
		t.Fatalf("want one step span in a valid trace, got %+v", steps)
	}
	if steps[0].Parent.TraceID() != steps[0].SpanContext.TraceID() && steps[0].Parent.IsValid() {
		t.Fatalf("unexpected parent: %+v", steps[0].Parent)
	}
}

func TestStampTraceThenExtractKeepsTheTraceID(t *testing.T) {
	installTestTracer(t)
	ctx, span := otel.Tracer("test").Start(t.Context(), "step")
	defer span.End()

	event := &types.Event{}
	stampTrace(ctx, event)
	got := trace.SpanContextFromContext(extractEventTrace(t.Context(), event)).TraceID()
	if got != span.SpanContext().TraceID() {
		t.Fatalf("extracted trace %s, want %s", got, span.SpanContext().TraceID())
	}
}
