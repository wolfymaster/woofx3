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

	desired := make(map[string]*types.WorkflowDefinition, len(resp.Workflows))
	for _, dbwf := range resp.Workflows {
		if !dbwf.GetEnabled() {
			continue
		}
		def, err := convertDBWorkflowToEngineWorkflow(dbwf)
		if err != nil {
			r.logger.Error("reconcile: convert failed", "workflow_id", dbwf.GetId(), "error", err)
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
	for _, def := range toAdd {
		if err := r.registry.Register(def); err != nil {
			r.logger.Error("reconcile: register failed", "workflow_id", def.ID, "error", err)
		}
	}
	for _, id := range toRemove {
		if err := r.registry.Remove(id); err != nil {
			r.logger.Error("reconcile: remove failed", "workflow_id", id, "error", err)
		}
	}
	if len(toAdd) > 0 || len(toRemove) > 0 {
		r.logger.Info("reconcile applied", "added", len(toAdd), "removed", len(toRemove))
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
