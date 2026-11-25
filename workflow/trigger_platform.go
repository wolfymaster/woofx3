package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/twitchtv/twirp"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// triggerLookup reads one module trigger by its canonical id.
// dbv1.ModuleService satisfies it.
type triggerLookup interface {
	GetTriggerByCanonicalId(ctx context.Context, req *dbv1.GetByCanonicalIdRequest) (*dbv1.TriggerResponse, error)
}

// triggerPlatformResolver pins a workflow's event trigger to the platform its
// module trigger declares, read from the trigger row its `$ref` names.
type triggerPlatformResolver struct {
	triggers triggerLookup
	logger   tasks.Logger
	timeout  time.Duration
}

// resolve sets def.Trigger.Platform. A trigger with no `$ref` stays unpinned.
// A `$ref` that names no trigger row also stays unpinned, with a warning:
// workflows written before a module renamed or dropped a trigger keep the
// behaviour they always had rather than stopping. Any other failure to read
// the row is returned, so the load fails into workflow health and the next
// reconcile pass retries it, instead of the workflow firing for every
// platform while the db proxy is unreachable.
func (r *triggerPlatformResolver) resolve(ctx context.Context, def *types.WorkflowDefinition) error {
	if def.Trigger == nil || def.Trigger.Type != types.TriggerTypeEvent || def.Trigger.Ref == "" {
		return nil
	}
	if r == nil || r.triggers == nil {
		return fmt.Errorf("workflow %s: trigger %q cannot be read: no module db client is configured", def.ID, def.Trigger.Ref)
	}
	readCtx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	resp, err := r.triggers.GetTriggerByCanonicalId(readCtx, &dbv1.GetByCanonicalIdRequest{CanonicalId: def.Trigger.Ref})
	var twerr twirp.Error
	if errors.As(err, &twerr) && twerr.Code() == twirp.NotFound {
		r.logger.Warn("Workflow trigger names no registered trigger; it fires for every platform",
			"workflow_id", def.ID, "trigger_ref", def.Trigger.Ref)
		return nil
	}
	if err != nil {
		return fmt.Errorf("workflow %s: reading trigger %q: %w", def.ID, def.Trigger.Ref, err)
	}
	def.Trigger.Platform = resp.GetTrigger().GetPlatform()
	return nil
}
