package main

import (
	"context"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// Reconciler periodically diffs the in-memory workflow registry against the
// canonical DB proxy list and applies adds/removes. It is the safety net that
// converges state when NATS lifecycle events are missed.
type Reconciler struct {
	manager  *WorkflowManager
	registry reconcilerRegistry
	dbClient dbv1.WorkflowService
	logger   tasks.Logger
	interval time.Duration
}

// reconcilerRegistry is the minimal registry surface Reconciler needs. The
// engine.WorkflowRegistry satisfies this interface implicitly.
type reconcilerRegistry interface {
	List() []*types.WorkflowDefinition
	Register(def *types.WorkflowDefinition) error
	Remove(id string) error
}

// newReconciler wires a reconciler. An interval of zero defaults to 5 minutes.
func newReconciler(manager *WorkflowManager, registry reconcilerRegistry, dbClient dbv1.WorkflowService, logger tasks.Logger, interval time.Duration) *Reconciler {
	if manager == nil {
		panic("reconciler requires a workflow manager: it records every load outcome as workflow health")
	}
	if interval == 0 {
		interval = 5 * time.Minute
	}
	return &Reconciler{
		manager:  manager,
		registry: registry,
		dbClient: dbClient,
		logger:   logger,
		interval: interval,
	}
}

// Run blocks until ctx is cancelled, reconciling at the configured interval.
func (r *Reconciler) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.reconcileOnce(ctx)
		}
	}
}

func (r *Reconciler) reconcileOnce(ctx context.Context) {
	if r.dbClient == nil {
		r.logger.Warn("reconcile: db client not configured, skipping")
		return
	}

	resp, err := r.dbClient.ListWorkflows(ctx, &dbv1.ListWorkflowsRequest{
		IncludeDisabled: false,
		PageSize:        1000,
	})
	if err != nil {
		r.logger.Error("reconcile: list workflows failed", "error", err)
		return
	}

	health := r.manager.Health()
	desired := make(map[string]*types.WorkflowDefinition, len(resp.Workflows))
	enabled := make(map[string]struct{}, len(resp.Workflows))
	for _, dbwf := range resp.Workflows {
		if !dbwf.GetEnabled() {
			continue
		}
		enabled[dbwf.GetId()] = struct{}{}
		def, err := convertDBWorkflowToEngineWorkflow(dbwf)
		if err != nil {
			health.Record(dbwf.GetId(), err)
			continue
		}
		desired[def.ID] = def
	}

	inMemList := r.registry.List()
	inMem := make(map[string]*types.WorkflowDefinition, len(inMemList))
	for _, def := range inMemList {
		inMem[def.ID] = def
	}

	toAdd, toRemove := reconcileDiff(inMem, desired)
	// A workflow that failed to load is absent from the registry, so it lands
	// in toAdd again on every pass. The health tracker logs only a change, so
	// the retry stays quiet until the outcome differs.
	added := 0
	for _, def := range toAdd {
		err := r.registry.Register(def)
		health.Record(def.ID, err)
		if err == nil {
			added++
		}
	}
	for _, id := range toRemove {
		if err := r.registry.Remove(id); err != nil {
			r.logger.Error("reconcile: remove failed", "workflow_id", id, "error", err)
		}
	}
	health.Retain(enabled)
	if added > 0 || len(toRemove) > 0 {
		r.logger.Info("reconcile applied", "added", added, "removed", len(toRemove))
	}
}

// reconcileDiff returns workflows in desired but not inMem (toAdd) and IDs in
// inMem but not desired (toRemove). Updates (same ID, different content) are
// handled by Register's overwrite semantics via the NATS event path and are
// intentionally not emitted here.
func reconcileDiff(inMem, desired map[string]*types.WorkflowDefinition) (toAdd []*types.WorkflowDefinition, toRemove []string) {
	for id, def := range desired {
		if _, ok := inMem[id]; !ok {
			toAdd = append(toAdd, def)
		}
	}
	for id := range inMem {
		if _, ok := desired[id]; !ok {
			toRemove = append(toRemove, id)
		}
	}
	return toAdd, toRemove
}
