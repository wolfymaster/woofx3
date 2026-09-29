package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/common/runtime/service"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/triggers"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// NATSEventPublisher implements engine.EventPublisher using NATS
type NATSEventPublisher struct {
	client *natsclient.Client
	logger tasks.Logger
}

func NewNATSEventPublisher(client *natsclient.Client, logger tasks.Logger) *NATSEventPublisher {
	return &NATSEventPublisher{
		client: client,
		logger: logger,
	}
}

func (p *NATSEventPublisher) Publish(event *types.Event) error {
	if p.client == nil {
		return fmt.Errorf("NATS client not available")
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	// Use event type as subject, replacing dots with periods is standard
	subject := event.Type
	if event.Subject != "" {
		subject = event.Subject
	}

	p.logger.Info("Publishing event to NATS", "type", event.Type, "subject", subject, "id", event.ID)

	return p.client.Publish(subject, data)
}

type WorkflowApp struct {
	*runtime.BaseApplication
	engine           *engine.Engine[AppServices]
	logger           tasks.Logger
	manager          *WorkflowManager
	natsSvc          *service.NATSService
	barkloaderSvc    *service.BarkloaderService
	moduleDbClient   dbv1.ModuleService
	alertDbClient    dbv1.AlertService
	workflowDbClient dbv1.WorkflowService
	scheduleReg      *triggers.ScheduleTriggerRegistrar
}

func NewWorkflowApp(logger tasks.Logger) *WorkflowApp {
	engine := engine.New[AppServices](logger)
	app := &WorkflowApp{
		BaseApplication: runtime.NewBaseApplication(),
		engine:          engine,
		logger:          logger,
	}

	// Create manager without a db client; SetServices wires it after config is loaded.
	app.manager = NewWorkflowManager(logger, app.engine, nil)

	return app
}

// SetServices wires the runtime services this app depends on. Called from
// main.go's RuntimeInit, after config has loaded and the services have been
// constructed. The services' clients may not be connected yet at the time of
// this call — Run() reads .Client() / .Connection() once the runtime has
// completed its connect phase.
func (a *WorkflowApp) SetServices(
	natsSvc *service.NATSService,
	barkloaderSvc *service.BarkloaderService,
	dbClient *dbv1.DbProxyClient,
	alertClient dbv1.AlertService,
	sceneManagerURL string,
) {
	a.natsSvc = natsSvc
	a.barkloaderSvc = barkloaderSvc
	a.moduleDbClient = dbClient.Module
	a.alertDbClient = alertClient
	a.workflowDbClient = dbClient.Workflow
	a.manager.SetDbClient(dbClient.Workflow)
	a.engine.SetAssetURLResolver(NewSceneManagerURLResolver(dbClient.Setting, sceneManagerURL, a.logger))
}

func (a *WorkflowApp) Init(ctx context.Context) error {
	// Workflows are loaded in Run, not here: Init fires before Run wires the
	// real trigger registrar, so loading workflows here would register them
	// against the default NoopRegistrar and leave cold-start workflows without
	// dynamic NATS subscriptions.
	a.logger.Info("Initializing workflow application")
	return nil
}

func (a *WorkflowApp) Run(ctx context.Context) error {
	a.logger.Info("Running workflow application")

	if a.natsSvc == nil || a.barkloaderSvc == nil {
		return fmt.Errorf("workflow app started without required services; SetServices must be called before Run")
	}

	natsClient := a.natsSvc.Client()
	barkloaderClient := a.barkloaderSvc.Client()

	registerService("barkloader", func() *barkloader.Client {
		return barkloaderClient
	})
	registerService("messageBus", func() *natsclient.Client {
		return natsClient
	})
	alertDbClient := a.alertDbClient
	registerService("alertLog", func() dbv1.AlertService {
		return alertDbClient
	})

	// Dynamic per-workflow trigger subscriptions: the registry drives
	// subscribe/unsubscribe as workflows enter and leave the engine.
	subscriber := newNatsSubscriber(natsClient)
	eventReg := triggers.NewEventTriggerRegistrar(subscriber, a.handleTriggerEvent, a.logger)
	a.scheduleReg = triggers.NewScheduleTriggerRegistrar(func(workflowID string) {
		now := time.Now()
		evt := &types.Event{
			ID:     fmt.Sprintf("sched-%s-%d", workflowID, now.UnixNano()),
			Type:   "workflow.schedule.fire",
			Source: "workflow/scheduler",
			Time:   now,
			Data:   map[string]any{"workflowId": workflowID},
		}
		if err := a.engine.FireByWorkflowID(workflowID, evt); err != nil {
			a.logger.Error("schedule fire failed", "workflow_id", workflowID, "error", err)
		}
	})
	a.scheduleReg.Start()
	composite := triggers.NewCompositeRegistrar()
	composite.Set("event", eventReg)
	composite.Set("schedule", a.scheduleReg)
	a.engine.Registry().SetRegistrar(composite)
	a.engine.Registry().SetLogger(a.logger)

	// Load workflows from DB now that the registrar is attached. Loading
	// earlier (in Init) would register them against the default
	// NoopRegistrar, leaving cold-start workflows without trigger
	// subscriptions until the reconciler catches up.
	if err := a.manager.LoadWorkflowsFromDB(ctx); err != nil {
		a.logger.Error("Failed to load workflows from database", "error", err)
		// Non-fatal: the reconciler will catch up if the DB is reachable later.
	}

	// Periodic safety net against dropped NATS lifecycle events: diff
	// the in-memory registry against the DB and apply adds/removes.
	reconciler := newReconciler(a.manager, a.engine.Registry(), a.manager.dbClient, a.logger, 0)
	go reconciler.Run(ctx)
	a.logger.Info("Reconciler started", "interval", reconciler.interval)

	publisher := NewNATSEventPublisher(natsClient, a.logger)
	a.engine.SetPublisher(publisher)
	a.logger.Info("Event publisher configured with NATS")

	// Run history. Optional on purpose: without a db proxy the engine runs
	// exactly as before and simply keeps no record, which is better than
	// refusing to run workflows because their history cannot be written.
	if a.workflowDbClient != nil {
		a.engine.SetRunRecorder(newDBRunRecorder(a.workflowDbClient, a.logger))
		a.logger.Info("Run recorder configured")
	} else {
		a.logger.Warn("No workflow db client; runs will not be recorded")
	}

	// DB-proxy workflow lifecycle events (source of truth for registry updates).
	// Subjects come from db/app/workers/publisher.go:58 as "db.workflow.{op}.{appId}".
	for _, subject := range []string{
		string(cloudevents.SubjectDbWorkflowCreatedPattern),
		string(cloudevents.SubjectDbWorkflowUpdatedPattern),
		string(cloudevents.SubjectDbWorkflowDeletedPattern),
	} {
		if err := a.subscribeToWorkflowEvents(natsClient, subject); err != nil {
			return fmt.Errorf("subscribe to %s: %w", subject, err)
		}
	}

	// Explicit "run this workflow now" commands. Separate from the CRUD
	// lifecycle above and decoded differently: this subject carries an ordinary
	// CloudEvent naming one workflow, not a registry change, so it cannot share
	// handleWorkflowEvent.
	//
	// Subscribed with a reply handler: a caller that sends a request, rather
	// than publishing, is told whether the run started and with which id. A
	// plain publish has no reply subject, so the answer is simply dropped.
	if _, err := natsClient.SubscribeWithReply(string(cloudevents.SubjectWorkflowExecute), a.handleWorkflowExecuteEvent); err != nil {
		a.logger.Error("Failed to subscribe to workflow execute events", "error", err)
	}

	if _, err := natsClient.SubscribeWithReply(string(cloudevents.SubjectWorkflowCancel), a.handleWorkflowCancelRequest); err != nil {
		a.logger.Error("Failed to subscribe to workflow cancel requests", "error", err)
	}

	if _, err := natsClient.Subscribe(string(cloudevents.SubjectWorkflowReplay), func(msg natsclient.Msg) {
		a.handleWorkflowReplayEvent(msg)
	}); err != nil {
		a.logger.Error("Failed to subscribe to workflow replay events", "error", err)
	}

	// "Run these actions now", from a caller that has actions and no workflow.
	if _, err := natsClient.Subscribe(string(cloudevents.SubjectActionExecute), func(msg natsclient.Msg) {
		a.handleActionExecuteEvent(msg)
	}); err != nil {
		a.logger.Error("Failed to subscribe to action execute events", "error", err)
	}

	appServices := buildAppServices()

	// Register the engine's built-in action handlers. The handler name
	// here is what `step.action` carries on workflow steps (see
	// `tasks/registry.go`), and what the bundled `woofx3` module's
	// `native` action declarations name as their `handler`. The engine
	// implements them; the manifest declares them. That split is the
	// point -- declaration and implementation stop living in one file.
	//
	// Each declares whether a dry run may call it (see tasks.ActionSpec).
	a.engine.RegisterActionWithSpec("function", WithServices(appServices, NewBarkloaderAction()), functionActionSpec)
	a.engine.RegisterActionWithSpec("alert", WithServices(appServices, NewAlertAction()), alertActionSpec)
	a.engine.RegisterActionWithSpec("chat.reply", WithServices(appServices, NewChatReplyAction()), chatReplyActionSpec)
	a.engine.RegisterActionWithSpec("print", func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		a.logger.Info("Action: print", "params", params)
		return params, nil
	}, tasks.ActionSpec{SideEffect: false})

	return a.engine.Start(ctx)
}

func (a *WorkflowApp) Terminate(ctx context.Context) error {
	a.logger.Info("Terminating workflow application")
	if a.scheduleReg != nil {
		a.scheduleReg.Stop()
	}
	return a.engine.Stop()
}

func (a *WorkflowApp) Engine() *engine.Engine[AppServices] {
	return a.engine
}

// subscribeToWorkflowEvents subscribes to workflow CRUD events from the DB proxy
func (a *WorkflowApp) subscribeToWorkflowEvents(natsClient *natsclient.Client, subjectPattern string) error {
	_, err := natsClient.Subscribe(subjectPattern, func(msg natsclient.Msg) {
		a.handleWorkflowEvent(msg)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to workflow events: %w", err)
	}

	a.logger.Info("Subscribed to workflow events", "subject", subjectPattern)
	return nil
}

// handleWorkflowEvent processes incoming workflow change events
func (a *WorkflowApp) handleWorkflowEvent(msg natsclient.Msg) {
	var evt cloudevents.WorkflowChangeEvent
	err := evt.Decode(msg.Data())
	if err != nil {
		a.logger.Error("Failed to parse workflow change event", "error", err, "subject", msg.Subject())
		return
	}

	changeData, err := evt.Data()
	if err != nil {
		a.logger.Error("Failed to extract workflow change data", "error", err)
		return
	}

	a.logger.Info("Received workflow event",
		"operation", changeData.Operation,
		"workflow_id", changeData.WorkflowID,
		"type", evt.Type())

	if changeData.IsCreateOrUpdate() {
		a.manager.HandleWorkflowCreateOrUpdate(&evt)
	} else if changeData.IsDeleted() {
		a.manager.HandleWorkflowDelete(changeData.WorkflowID)
	} else {
		a.logger.Warn("Unknown workflow operation", "operation", changeData.Operation)
	}
}

// executeRequestOptions are the optional fields of a workflow.execute event's
// data, beyond the workflow it names.
type executeRequestOptions struct {
	// TriggerData is the sample payload the run resolves `${trigger.data...}`
	// against. Absent, the run starts from the execute event itself.
	TriggerData    map[string]any `json:"triggerData"`
	Platform       string         `json:"platform"`
	SkipConditions bool           `json:"skipConditions"`
	DryRun         bool           `json:"dryRun"`
}

// executeReply answers a workflow.execute request.
//
// Outcome is "started", "conditions_not_met" or "refused". The api decodes it
// in api/src/routes/workflows-execution.ts, so a field renamed here must be
// renamed there.
type executeReply struct {
	Outcome     string                  `json:"outcome"`
	ExecutionID string                  `json:"executionId,omitempty"`
	EventType   string                  `json:"eventType,omitempty"`
	Unmet       []engine.UnmetCondition `json:"unmet,omitempty"`
	Error       string                  `json:"error,omitempty"`
}

// handleWorkflowExecuteEvent runs one workflow on request, and returns the
// reply for a caller that asked for one.
//
// Distinct from handleWorkflowEvent, which decodes a registry change: this
// subject carries an ordinary CloudEvent whose data names the workflow to run.
//
// Without sample trigger data the event is handed to the engine unchanged
// rather than synthesized afresh, so its correlation attributes reach the
// execution -- that is what lets the caller who asked for this run be told how
// it ended, since the run happens here long after their request returned.
func (a *WorkflowApp) handleWorkflowExecuteEvent(msg natsclient.Msg) []byte {
	event, err := a.validateCloudEvent(msg.Data())
	if err != nil {
		a.logger.Error("Invalid workflow execute event",
			"error", err,
			"subject", msg.Subject())
		return encodeExecuteReply(executeReply{Outcome: "refused", Error: err.Error()})
	}

	workflowID, _ := event.Data["workflowId"].(string)
	if workflowID == "" {
		a.logger.Error("Workflow execute event names no workflow", "event_id", event.ID)
		return encodeExecuteReply(executeReply{Outcome: "refused", Error: "no workflowId"})
	}

	var options executeRequestOptions
	if err := decodeEventData(event.Data, &options); err != nil {
		a.logger.Error("Workflow execute event options unreadable", "event_id", event.ID, "error", err)
		return encodeExecuteReply(executeReply{Outcome: "refused", Error: err.Error()})
	}

	a.logger.Info("Running workflow on request",
		"workflow_id", workflowID,
		"trigger_id", event.TriggerID,
		"triggered_by", event.TriggeredBy,
		"sample_data", options.TriggerData != nil,
		"dry_run", options.DryRun)

	// A workflow absent from the registry is the common failure here -- it was
	// deleted, disabled, or never reached this engine. A caller that published
	// learns that from the silence, because there is no run to fail; one that
	// sent a request is told.
	result, err := a.engine.RunManual(engine.ManualRun{
		WorkflowID:     workflowID,
		Request:        event,
		TriggerData:    options.TriggerData,
		Platform:       options.Platform,
		SkipConditions: options.SkipConditions,
		DryRun:         options.DryRun,
	})
	if err != nil {
		a.logger.Error("Failed to run requested workflow",
			"workflow_id", workflowID,
			"trigger_id", event.TriggerID,
			"error", err)
		return encodeExecuteReply(executeReply{Outcome: "refused", Error: err.Error()})
	}

	return encodeExecuteReply(executeReply{
		Outcome:     string(result.Outcome),
		ExecutionID: result.ExecutionID,
		EventType:   result.EventType,
		Unmet:       result.Unmet,
	})
}

// decodeEventData reads an event's data map into a typed shape.
func decodeEventData(data map[string]any, into any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

func encodeExecuteReply(reply executeReply) []byte {
	raw, err := json.Marshal(reply)
	if err != nil {
		// Only reachable with an unmarshalable condition value, which came
		// from a definition that was itself decoded from JSON.
		raw, _ = json.Marshal(executeReply{Outcome: "refused", Error: err.Error()})
	}
	return raw
}

// cancelRequest asks for a run to stop.
type cancelRequest struct {
	ExecutionID string `json:"executionId"`
	Reason      string `json:"reason"`
}

// cancelReply answers a workflow.cancel request.
//
// Outcome is "cancelled", "already_finished", "not_found" or "refused"; Status
// is the run's status after the request. Decoded in
// api/src/routes/workflows-execution.ts.
type cancelReply struct {
	Outcome string `json:"outcome"`
	Status  string `json:"status,omitempty"`
	Error   string `json:"error,omitempty"`
}

// handleWorkflowCancelRequest stops a run and replies with what that did.
//
// A plain JSON body rather than a CloudEvent: this is a command to one
// service with an answer, not an event anything else reacts to.
func (a *WorkflowApp) handleWorkflowCancelRequest(msg natsclient.Msg) []byte {
	var req cancelRequest
	if err := json.Unmarshal(msg.Data(), &req); err != nil || req.ExecutionID == "" {
		a.logger.Error("Invalid workflow cancel request", "subject", msg.Subject(), "error", err)
		return encodeCancelReply(cancelReply{Outcome: "refused", Error: "executionId is required"})
	}

	result, err := a.engine.Cancel(req.ExecutionID, req.Reason)
	if errors.Is(err, engine.ErrExecutionNotFound) {
		return encodeCancelReply(cancelReply{Outcome: "not_found"})
	}
	if err != nil {
		a.logger.Error("Workflow cancel failed", "execution", req.ExecutionID, "error", err)
		return encodeCancelReply(cancelReply{Outcome: "refused", Error: err.Error()})
	}
	return encodeCancelReply(cancelReply{Outcome: string(result.Outcome), Status: string(result.Status)})
}

func encodeCancelReply(reply cancelReply) []byte {
	raw, _ := json.Marshal(reply)
	return raw
}

// actionExecuteMessage asks for a list of actions to run.
//
// Decoded into a typed shape rather than through validateCloudEvent: the
// actions are a request, not an event any workflow reads. The trigger event
// inside it is what the actions resolve their `${trigger.data...}` against, so
// it travels whole rather than being rebuilt from this envelope.
type actionExecuteMessage struct {
	ID   string `json:"id"`
	Data struct {
		Label   string                 `json:"label"`
		Actions []types.TaskDefinition `json:"actions"`
		Event   *types.Event           `json:"event"`
	} `json:"data"`
}

// handleActionExecuteEvent runs an action list on request.
func (a *WorkflowApp) handleActionExecuteEvent(msg natsclient.Msg) {
	var message actionExecuteMessage
	if err := json.Unmarshal(msg.Data(), &message); err != nil {
		a.logger.Error("Invalid action execute event", "error", err, "subject", msg.Subject())
		return
	}

	executionID, err := a.engine.RunActions(engine.ActionRun{
		Label:   message.Data.Label,
		Actions: message.Data.Actions,
		Event:   message.Data.Event,
	})
	if err != nil {
		a.logger.Error("Failed to run requested actions",
			"label", message.Data.Label,
			"event_id", message.ID,
			"error", err)
		return
	}

	a.logger.Info("Running actions on request",
		"label", message.Data.Label,
		"actions", len(message.Data.Actions),
		"execution", executionID)
}

// replayMessage asks for a recorded run to run again.
//
// Decoded into a typed shape rather than through validateCloudEvent: its data is
// a structured request, not an event any workflow reads, and the trigger event
// and step outcomes inside it are what the replay is built from.
type replayMessage struct {
	ID          string `json:"id"`
	TriggerID   string `json:"triggerId"`
	TriggeredBy string `json:"triggeredBy"`
	Data        struct {
		WorkflowID   string `json:"workflowId"`
		TriggerEvent string `json:"triggerEvent"`
		FromTaskID   string `json:"fromTaskId"`
		DryRun       bool   `json:"dryRun"`
		Steps        []struct {
			TaskID  string `json:"taskId"`
			Status  string `json:"status"`
			Attempt int    `json:"attempt"`
			Outputs string `json:"outputs"`
		} `json:"steps"`
	} `json:"data"`
}

// handleWorkflowReplayEvent runs a recorded run again. The engine decides
// whether the replay can run and announces a refusal itself, so a rejected
// replay is not logged a second time here.
func (a *WorkflowApp) handleWorkflowReplayEvent(msg natsclient.Msg) {
	var message replayMessage
	if err := json.Unmarshal(msg.Data(), &message); err != nil {
		a.logger.Error("Invalid workflow replay event", "error", err, "subject", msg.Subject())
		return
	}
	if message.Data.WorkflowID == "" {
		a.logger.Error("Workflow replay event names no workflow", "event_id", message.ID)
		return
	}

	req := engine.ReplayRequest{
		WorkflowID:  message.Data.WorkflowID,
		FromTaskID:  message.Data.FromTaskID,
		TriggerID:   message.TriggerID,
		TriggeredBy: message.TriggeredBy,
		DryRun:      message.Data.DryRun,
	}

	if message.Data.TriggerEvent != "" {
		var event types.Event
		if err := json.Unmarshal([]byte(message.Data.TriggerEvent), &event); err != nil {
			// Left nil rather than dropping the request: the engine refuses a
			// replay with no trigger event and says why, which the caller sees.
			a.logger.Warn("Recorded trigger event unreadable", "workflow_id", req.WorkflowID, "error", err)
		} else {
			req.TriggerEvent = &event
		}
	}

	for _, step := range message.Data.Steps {
		var outputs map[string]any
		if step.Outputs != "" {
			if err := json.Unmarshal([]byte(step.Outputs), &outputs); err != nil {
				a.logger.Warn("Recorded step outputs unreadable", "task", step.TaskID, "error", err)
			}
		}
		req.Steps = append(req.Steps, engine.ReplayStep{
			TaskID:  step.TaskID,
			Status:  step.Status,
			Attempt: step.Attempt,
			Outputs: outputs,
		})
	}

	a.logger.Info("Replay requested",
		"workflow_id", req.WorkflowID,
		"from_task", req.FromTaskID,
		"trigger_id", req.TriggerID)
	_ = a.engine.Replay(req)
}

// validateCloudEvent validates that incoming data conforms to CloudEvents spec
func (a *WorkflowApp) validateCloudEvent(data []byte) (*types.Event, error) {
	var event types.Event
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	// CloudEvents required fields validation
	if event.ID == "" {
		return nil, fmt.Errorf("event missing required field: id")
	}
	if event.Type == "" {
		return nil, fmt.Errorf("event missing required field: type")
	}
	if event.Source == "" {
		return nil, fmt.Errorf("event missing required field: source")
	}

	return &event, nil
}

// handleTriggerEvent processes incoming events that may trigger workflows.
// Takes primitive args so the dynamic trigger registrar can invoke it
// without synthesizing a Msg.
func (a *WorkflowApp) handleTriggerEvent(payload []byte, subject string) {
	// Validate CloudEvents format
	event, err := a.validateCloudEvent(payload)
	if err != nil {
		a.logger.Error("Invalid event format",
			"error", err,
			"subject", subject,
			"raw_data", string(payload))
		return
	}

	// Promoted from Debug → Info: the chain of "did the engine see the
	// event, was a workflow matched, was it dispatched" is the most
	// common debugging path when a trigger appears not to fire, so this
	// belongs in default-level logs. If event volume becomes a concern
	// (very high QPS triggers), demote per-subject behind a config flag.
	a.logger.Info("Received trigger event",
		"type", event.Type,
		"id", event.ID,
		"subject", subject)

	// Route to engine for workflow matching and execution
	if err := a.engine.HandleEvent(event); err != nil {
		a.logger.Error("Failed to handle trigger event",
			"error", err,
			"type", event.Type,
			"id", event.ID)
		// Continue processing other events (fail fast per event)
	}
}
