package engine

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// MaxTriggerDataBytes bounds the sample payload a manual run may carry, as
// encoded JSON. A real platform event is a few hundred bytes; this leaves room
// for a hand-written sample while keeping a pasted blob off the bus and out of
// the run history. Must match MAX_TRIGGER_DATA_BYTES in
// api/src/routes/workflows-execution.ts.
const MaxTriggerDataBytes = 16 * 1024

// ManualRun asks for one workflow to run now.
type ManualRun struct {
	WorkflowID string
	// Request is the event that asked for the run. It carries the correlation
	// attributes (TriggerID, TriggeredBy) the run's lifecycle is reported
	// against.
	Request *types.Event
	// TriggerData, when non-nil, starts the run from an event shaped like one
	// the workflow's trigger listens for, with this as its data, so
	// `${trigger.data...}` resolves exactly as it would for a real event.
	// When nil the run starts from Request itself, and its trigger
	// conditions are not consulted.
	TriggerData map[string]any
	// Platform stamps the synthesized event's platform, for workflows whose
	// conditions read `${trigger.platform}`. Only used with TriggerData.
	Platform string
	// SkipConditions runs the workflow even when TriggerData does not satisfy
	// its trigger conditions.
	SkipConditions bool
	// DryRun runs the workflow without its side effects: each side-effecting
	// action records what it would do, and waits complete at once.
	DryRun bool
}

// ManualRunOutcome is what a manual run request did.
type ManualRunOutcome string

const (
	ManualRunStarted          ManualRunOutcome = "started"
	ManualRunConditionsNotMet ManualRunOutcome = "conditions_not_met"
)

// ManualRunResult reports a manual run request's outcome. ExecutionID is set
// when a run started; Unmet lists the conditions the sample failed when one
// did not.
type ManualRunResult struct {
	Outcome     ManualRunOutcome
	ExecutionID string
	EventType   string
	Unmet       []UnmetCondition
}

// RunManual starts one workflow on request and returns once the run has an
// id, before any task runs.
//
// Unlike HandleEvent, the event is not offered to every workflow listening for
// its type: only the named workflow runs. That is what lets a creator try a
// workflow with a sample payload without firing every other workflow on the
// same event, and their real side effects with it.
func (e *Engine[TServices]) RunManual(req ManualRun) (ManualRunResult, error) {
	if req.Request == nil {
		return ManualRunResult{}, fmt.Errorf("RunManual: no request event")
	}
	def, err := e.workflowRegistry.Get(req.WorkflowID)
	if err != nil {
		return ManualRunResult{}, fmt.Errorf("RunManual: %w", err)
	}

	event := req.Request
	if req.TriggerData != nil {
		event, err = sampleTriggerEvent(def, req)
		if err != nil {
			return ManualRunResult{}, fmt.Errorf("RunManual: %w", err)
		}
	}
	viewer := e.viewerLoader(event)
	if req.TriggerData != nil && !req.SkipConditions {
		if unmet := e.unmetTriggerConditions(def, event, viewer); len(unmet) > 0 {
			e.logger.Info("Manual run refused: trigger conditions not met",
				"workflow", def.ID,
				"trigger_id", event.TriggerID,
				"unmet", describeUnmet(unmet))
			return ManualRunResult{Outcome: ManualRunConditionsNotMet, EventType: event.Type, Unmet: unmet}, nil
		}
	}

	// A request event stamped by a dry run stays dry, whatever was asked.
	execution := e.beginExecutionAs(def, event, req.DryRun || event.DryRun, viewer)
	go e.runExecution(def, execution, event)
	return ManualRunResult{Outcome: ManualRunStarted, ExecutionID: execution.ID, EventType: event.Type}, nil
}

// sampleTriggerEvent builds the event a manual run with sample data starts
// from: the workflow's own trigger event type, the sample as its data, and the
// request's id and correlation attributes.
//
// A workflow without an event trigger -- a scheduled one -- has no event type
// to imitate, so its sample keeps the request's type.
func sampleTriggerEvent(def *types.WorkflowDefinition, req ManualRun) (*types.Event, error) {
	encoded, err := json.Marshal(req.TriggerData)
	if err != nil {
		return nil, fmt.Errorf("trigger data is not JSON: %w", err)
	}
	if len(encoded) > MaxTriggerDataBytes {
		return nil, fmt.Errorf("trigger data is %d bytes, over the %d byte limit", len(encoded), MaxTriggerDataBytes)
	}

	eventType := req.Request.Type
	if def.Trigger != nil && def.Trigger.Type == "event" && def.Trigger.Event != "" {
		eventType = def.Trigger.Event
	}
	eventTime := req.Request.Time
	if eventTime.IsZero() {
		eventTime = time.Now()
	}
	return &types.Event{
		ID:          req.Request.ID,
		Type:        eventType,
		Source:      req.Request.Source,
		Time:        eventTime,
		Platform:    req.Platform,
		SessionID:   req.Request.SessionID,
		TriggerID:   req.Request.TriggerID,
		TriggeredBy: req.Request.TriggeredBy,
		Data:        req.TriggerData,
	}, nil
}
