package main

import (
	"context"
	"encoding/json"
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
	engine         *engine.Engine[AppServices]
	logger         tasks.Logger
	manager        *WorkflowManager
	natsSvc        *service.NATSService
	barkloaderSvc  *service.BarkloaderService
	moduleDbClient dbv1.ModuleService
	scheduleReg    *triggers.ScheduleTriggerRegistrar
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
) {
	a.natsSvc = natsSvc
	a.barkloaderSvc = barkloaderSvc
	a.moduleDbClient = dbClient.Module
	a.manager.SetDbClient(dbClient.Workflow)
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

	// Explicit "execute this workflow now" commands (separate from lifecycle).
	if err := a.subscribeToWorkflowEvents(natsClient, string(cloudevents.SubjectWorkflowExecute)); err != nil {
		a.logger.Error("Failed to subscribe to workflow execute events", "error", err)
	}

	appServices := buildAppServices()

	// Register the engine's built-in action handlers. The handler name
	// here is what `step.action` carries on workflow steps (see
	// `tasks/registry.go`); the corresponding action declaration rows
	// in db (canonical ids `builtin:action:{name}`) are upserted by
	// `registerBuiltinActions` below so the UI can list them and
	// workflow steps can $ref them. Same SYSTEM:builtin (created_by_type,
	// created_by_ref) namespace barkloader uses for its own compile-time
	// built-in actions — keeps every system-provided row in one bucket.
	a.engine.RegisterAction("function", WithServices(appServices, NewBarkloaderAction()))
	a.engine.RegisterAction("alert", WithServices(appServices, NewAlertAction()))
	a.engine.RegisterAction("print", func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		a.logger.Info("Action: print", "params", params)
		return params, nil
	})

	// Mirror those handlers as action rows in db so they're addressable
	// by canonical id from workflow JSON ($ref) and from the UI's
	// action picker. Best-effort — db being unavailable shouldn't stop
	// the engine from starting; the handlers are still callable, just
	// not discoverable via db.
	//
	// Same pattern for built-in triggers — engine lifecycle events
	// that workflows can bind to without installing a module.
	if a.moduleDbClient != nil {
		if err := a.registerBuiltinActions(ctx); err != nil {
			a.logger.Warn("Failed to register built-in action declarations with db", "error", err)
		}
		if err := a.registerBuiltinTriggers(ctx); err != nil {
			a.logger.Warn("Failed to register built-in trigger declarations with db", "error", err)
		}
	} else {
		a.logger.Warn("db module client not configured; built-in action / trigger declarations will not be registered")
	}

	return a.engine.Start(ctx)
}

// builtinCreatedByType / builtinCreatedByRef are the namespace pair
// used for every built-in trigger/action row written by the workflow
// service. They match what barkloader's autoload uses for its
// compile-time built-in actions (see
// `barkloader/app/src/services/builtin_actions/autoload.rs`), so every
// system-provided row lives under the same `(SYSTEM, builtin)` bucket
// regardless of which service registered it. The `created_by_ref`
// segment also becomes the moduleId of every canonical id —
// `builtin:action:alert`, `builtin:trigger:workflow.created`, etc.
const (
	builtinCreatedByType = "SYSTEM"
	builtinCreatedByRef  = "builtin"
)

// registerBuiltinActions upserts an action row for every engine
// built-in handler. Idempotent — runs every startup, the
// (created_by_type, created_by_ref, manifest_id) uniqueness on the
// actions table dedupes. `call` is empty for non-function handlers
// (the handler itself does the dispatch); the type column tells the
// install path which handler to bind workflow steps to.
func (a *WorkflowApp) registerBuiltinActions(ctx context.Context) error {
	builtins := []*dbv1.ActionInput{
		{
			Name:         "Function",
			Description:  "Invoke a sandboxed module function. Set `function` to the canonical function id; everything else in `parameters` is forwarded to the function as a single object argument.",
			Call:         "",
			ParamsSchema: "[]",
			ManifestId:   "function",
			Type:         "function",
		},
		{
			Name:         "Alert",
			Description:  "Publish an on-stream alert. Parameters (mediaUrl, audioUrl, text, duration, options, …) are forwarded to subscribers on the `ui.notify.alert` NATS subject; the UI / overlays render the alert.",
			Call:         "",
			ParamsSchema: "[]",
			ManifestId:   "alert",
			Type:         "alert",
		},
		{
			Name:         "Print",
			Description:  "Log the step's parameters to the workflow service log. Useful for debugging workflow shape and expression resolution.",
			Call:         "",
			ParamsSchema: "[]",
			ManifestId:   "print",
			Type:         "print",
		},
	}
	resp, err := a.moduleDbClient.RegisterActions(ctx, &dbv1.RegisterActionsRequest{
		// ModuleKey/ModuleName/Version are unused when (CreatedByType,
		// CreatedByRef) override the default MODULE namespace; pass empty
		// to make that explicit (mirrors barkloader's autoload).
		ModuleKey:     "",
		ModuleName:    "workflow-builtin",
		Version:       "builtin",
		Actions:       builtins,
		CreatedByType: builtinCreatedByType,
		CreatedByRef:  builtinCreatedByRef,
	})
	if err != nil {
		return fmt.Errorf("RegisterActions: %w", err)
	}
	if resp.GetStatus().GetCode() != dbv1.ResponseStatus_OK {
		return fmt.Errorf("RegisterActions returned %s: %s", resp.GetStatus().GetCode(), resp.GetStatus().GetMessage())
	}
	a.logger.Info("Registered built-in action declarations with db", "count", len(builtins))
	return nil
}

// registerBuiltinTriggers upserts a trigger row for every engine-emitted
// system event a workflow might want to bind to. Runs every startup,
// idempotent on (created_by_type, created_by_ref, manifest_id). The
// `event` column carries the actual NATS subject the engine subscribes
// to when a workflow's trigger.$ref points at one of these — so a
// workflow with `trigger.$ref: "builtin:trigger:workflow.created"`
// subscribes to the matching subject without any module being
// installed first.
func (a *WorkflowApp) registerBuiltinTriggers(ctx context.Context) error {
	// Each entry is (manifest_id, NATS subject, display name, description).
	// Today we surface workflow lifecycle events; extend this list as
	// the engine starts emitting more system-level subjects worth
	// reacting to.
	type builtinTrigger struct {
		manifestID  string
		event       string
		name        string
		description string
	}
	builtins := []builtinTrigger{
		{
			manifestID:  "workflow.created",
			event:       string(cloudevents.SubjectDbWorkflowCreatedPattern),
			name:        "Workflow created",
			description: "Fires when any workflow is created. Useful for meta-workflows that audit, mirror, or react to workflow authoring activity.",
		},
		{
			manifestID:  "workflow.updated",
			event:       string(cloudevents.SubjectDbWorkflowUpdatedPattern),
			name:        "Workflow updated",
			description: "Fires when any workflow is updated.",
		},
		{
			manifestID:  "workflow.deleted",
			event:       string(cloudevents.SubjectDbWorkflowDeletedPattern),
			name:        "Workflow deleted",
			description: "Fires when any workflow is deleted.",
		},
	}

	inputs := make([]*dbv1.TriggerInput, 0, len(builtins))
	for _, b := range builtins {
		inputs = append(inputs, &dbv1.TriggerInput{
			Category:      "system.workflow",
			Name:          b.name,
			Description:   b.description,
			Event:         b.event,
			ConfigSchema:  "[]",
			AllowVariants: false,
			ManifestId:    b.manifestID,
		})
	}

	resp, err := a.moduleDbClient.RegisterTriggers(ctx, &dbv1.RegisterTriggersRequest{
		ModuleKey:     "",
		ModuleName:    "workflow-builtin",
		Version:       "builtin",
		Triggers:      inputs,
		CreatedByType: builtinCreatedByType,
		CreatedByRef:  builtinCreatedByRef,
	})
	if err != nil {
		return fmt.Errorf("RegisterTriggers: %w", err)
	}
	if resp.GetStatus().GetCode() != dbv1.ResponseStatus_OK {
		return fmt.Errorf("RegisterTriggers returned %s: %s", resp.GetStatus().GetCode(), resp.GetStatus().GetMessage())
	}
	a.logger.Info("Registered built-in trigger declarations with db", "count", len(builtins))
	return nil
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
		"application_id", changeData.ApplicationID,
		"type", evt.Type())

	if changeData.IsCreateOrUpdate() {
		a.manager.HandleWorkflowCreateOrUpdate(&evt)
	} else if changeData.IsDeleted() {
		a.manager.HandleWorkflowDelete(changeData.WorkflowID)
	} else {
		a.logger.Warn("Unknown workflow operation", "operation", changeData.Operation)
	}
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

