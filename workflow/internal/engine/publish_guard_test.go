package engine

import (
	"strings"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func publishingWorkflow(eventType string) *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:      "wf-publish",
		Name:    "Publish",
		Trigger: &types.TriggerConfig{Type: "event", Event: "thing.happened"},
		Tasks: []types.TaskDefinition{{
			ID:         "publish",
			Type:       "action",
			Action:     "publish_event",
			Parameters: map[string]any{"eventType": eventType},
		}},
	}
}

// A workflow is user- or module-authored, so it must not reach the subjects
// the engine commands itself with or the events it acts on.
func TestRegisteringAWorkflowThatPublishesAReservedSubjectFails(t *testing.T) {
	cases := map[string]string{
		"widget.queue.clear":    `reserved for the engine ("widget.queue."); choose a name`,
		"ui.notify.alert":       `reserved for the engine ("ui.notify.")`,
		"db.workflow.deleted.x": `reserved for the engine ("db.")`,
		"engine.obs.command":    `reserved for the engine ("engine.")`,
		"workflow.cancel":       `reserved for the engine ("workflow.cancel")`,
		"message.send":          `reserved for the engine ("message.send")`,
		"channel.cheer":         `reserved for the engine ("channel."); to test a workflow against a platform event, fire it with the api's simulateTwitchEvent`,
		"stream.online":         "simulateTwitchEvent",
		"custom.*":              "wildcards, whitespace and control characters",
		"custom.\u00a0event":    "wildcards, whitespace and control characters",
		"custom.\x07event":      "wildcards, whitespace and control characters",
	}
	for eventType, want := range cases {
		engine := newExecEngine(t)
		err := engine.RegisterWorkflow(publishingWorkflow(eventType))
		if err == nil || !strings.Contains(err.Error(), want) || !strings.Contains(err.Error(), `task "publish"`) {
			t.Errorf("%s: err = %v, want it to name the task and say %q", eventType, err, want)
		}
		if _, getErr := engine.GetWorkflow("wf-publish"); getErr == nil {
			t.Errorf("%s: the refused workflow was registered", eventType)
		}
	}
}

func TestRegisteringAWorkflowThatPublishesItsOwnEventSucceeds(t *testing.T) {
	for _, eventType := range []string{"badge.awarded", "stream.started.notification", "rewards.granted", "slobs.fan", "${trigger.data.kind}"} {
		if err := newExecEngine(t).RegisterWorkflow(publishingWorkflow(eventType)); err != nil {
			t.Errorf("%s: %v", eventType, err)
		}
	}
}

// An eventType built from an expression is only known once it resolves.
func TestPublishingAReservedSubjectFailsAtRunTime(t *testing.T) {
	engine := newExecEngine(t)
	publisher := &loopbackPublisher{engine: engine}
	engine.SetPublisher(publisher)

	action, err := engine.actionRegistry.Get("publish_event")
	if err != nil {
		t.Fatalf("publish_event not registered: %v", err)
	}
	ctx := tasks.ActionContext[execSvcs]{
		WorkflowID:   "wf-publish",
		TriggerEvent: &types.Event{ID: "e1", Type: "thing.happened", Source: "test", Time: time.Now()},
	}
	_, err = action(ctx, map[string]any{"eventType": "widget.queue.skip"})
	if err == nil || !strings.Contains(err.Error(), "reserved for the engine") {
		t.Fatalf("err = %v, want a reserved-subject refusal", err)
	}
	if len(publisher.published) != 0 {
		t.Fatalf("published %d events, want none", len(publisher.published))
	}
}

// A dry run must fail where the real run would, not describe a publish the
// engine would refuse.
func TestDryRunOfAReservedSubjectFails(t *testing.T) {
	engine := newExecEngine(t)
	publisher := &loopbackPublisher{engine: engine}
	engine.SetPublisher(publisher)

	spec, err := engine.actionRegistry.Spec("publish_event")
	if err != nil {
		t.Fatalf("publish_event spec: %v", err)
	}
	if spec.DryRun == nil {
		t.Fatalf("publish_event has no dry-run description")
	}
	if _, err := spec.DryRun(map[string]any{"eventType": "widget.queue.skip"}); err == nil || !strings.Contains(err.Error(), "reserved for the engine") {
		t.Fatalf("err = %v, want a reserved-subject refusal", err)
	}
	if _, err := spec.DryRun(map[string]any{"eventType": "badge.awarded"}); err != nil {
		t.Fatalf("badge.awarded: %v", err)
	}
	if len(publisher.published) != 0 {
		t.Fatalf("published %d events, want none", len(publisher.published))
	}
}

// The db holds the refused version, so the one it replaced must stop firing
// rather than run on unseen.
func TestARefusedReplacementUnregistersTheWorkflow(t *testing.T) {
	engine := newExecEngine(t)
	if err := engine.RegisterWorkflow(publishingWorkflow("badge.awarded")); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	if err := engine.RegisterWorkflow(publishingWorkflow("widget.queue.clear")); err == nil {
		t.Fatal("the reserved replacement was accepted")
	}
	if _, err := engine.GetWorkflow("wf-publish"); err == nil {
		t.Fatal("the replaced workflow is still registered")
	}
	if got := engine.Registry().GetByEvent("thing.happened"); len(got) != 0 {
		t.Fatalf("%d workflows still fire on the trigger, want none", len(got))
	}
}
