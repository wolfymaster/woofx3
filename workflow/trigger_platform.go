package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/twitchtv/twirp"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/platformgateway"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// triggerReadTimeout bounds the single trigger read a workflow lifecycle event
// makes while it holds the manager's load lock.
const triggerReadTimeout = 2 * time.Second

// triggerLookup reads module triggers. dbv1.ModuleService satisfies it.
type triggerLookup interface {
	GetTriggerByCanonicalId(ctx context.Context, req *dbv1.GetByCanonicalIdRequest) (*dbv1.TriggerResponse, error)
	ListTriggers(ctx context.Context, req *dbv1.ListTriggersRequest) (*dbv1.ListTriggersResponse, error)
}

// pinSource answers the platform of the module trigger a `$ref` names. found
// is false when no trigger row has that canonical id.
type pinSource interface {
	pinFor(ctx context.Context, ref string) (platform string, found bool, err error)
}

// listedPins answers from one ListTriggers read, so a pass over every
// workflow makes one db call however many of them carry a `$ref`.
type listedPins struct {
	pins map[string]string
	err  error
}

func (l listedPins) pinFor(_ context.Context, ref string) (string, bool, error) {
	if l.err != nil {
		return "", false, l.err
	}
	platform, found := l.pins[ref]
	return platform, found, nil
}

// lookedUpPins reads the one trigger a single workflow names.
type lookedUpPins struct {
	triggers triggerLookup
}

func (l lookedUpPins) pinFor(ctx context.Context, ref string) (string, bool, error) {
	readCtx, cancel := context.WithTimeout(ctx, triggerReadTimeout)
	defer cancel()
	resp, err := l.triggers.GetTriggerByCanonicalId(readCtx, &dbv1.GetByCanonicalIdRequest{CanonicalId: ref})
	var twerr twirp.Error
	if errors.As(err, &twerr) && (twerr.Code() == twirp.NotFound || twerr.Code() == twirp.InvalidArgument) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return resp.GetTrigger().GetPlatform(), true, nil
}

// triggerPlatformResolver pins a workflow's event trigger to the platform its
// module trigger declares, read from the trigger row its `$ref` names.
type triggerPlatformResolver struct {
	triggers triggerLookup
	logger   tasks.Logger
	// listTimeout bounds the one trigger list a pass reads.
	listTimeout time.Duration
}

// listed reads every trigger once. A failed read is kept and answered to
// each `$ref` the pass resolves, so those loads fail into health and the next
// pass retries; workflows without a `$ref` load regardless.
func (r *triggerPlatformResolver) listed(ctx context.Context) pinSource {
	if r == nil || r.triggers == nil {
		return listedPins{err: errors.New("no module db client is configured")}
	}
	listCtx, cancel := context.WithTimeout(ctx, r.listTimeout)
	defer cancel()
	resp, err := r.triggers.ListTriggers(listCtx, &dbv1.ListTriggersRequest{})
	if err != nil {
		return listedPins{err: fmt.Errorf("listing triggers: %w", err)}
	}
	pins := make(map[string]string, len(resp.GetTriggers()))
	for _, trigger := range resp.GetTriggers() {
		pins[canonicalTriggerID(trigger)] = trigger.GetPlatform()
	}
	return listedPins{pins: pins}
}

// lookedUp reads one trigger at a time, for a single workflow's load.
func (r *triggerPlatformResolver) lookedUp() pinSource {
	if r == nil || r.triggers == nil {
		return listedPins{err: errors.New("no module db client is configured")}
	}
	return lookedUpPins{triggers: r.triggers}
}

// resolve sets def.Trigger.Platform. A trigger with no `$ref` stays unpinned.
// A `$ref` that names no trigger row, or is not a canonical id at all, also
// stays unpinned, with a warning: workflows written before a module renamed
// or dropped a trigger keep the behaviour they always had rather than
// stopping. A failed read, or a row whose platform is outside the contract,
// is returned, so the load fails into workflow health and the next pass
// retries it, instead of the workflow firing for every platform.
func (r *triggerPlatformResolver) resolve(ctx context.Context, def *types.WorkflowDefinition, pins pinSource) error {
	if def.Trigger == nil || def.Trigger.Type != types.TriggerTypeEvent || def.Trigger.Ref == "" {
		return nil
	}
	platform, found, err := pins.pinFor(ctx, def.Trigger.Ref)
	if err != nil {
		return fmt.Errorf("workflow %s: reading trigger %q: %w", def.ID, def.Trigger.Ref, err)
	}
	if !found {
		if r != nil && r.logger != nil {
			r.logger.Warn("Workflow trigger names no registered trigger; it fires for every platform",
				"workflow_id", def.ID, "trigger_ref", def.Trigger.Ref)
		}
		return nil
	}
	pin := platformgateway.PlatformID(platform)
	if platform != "" && !pin.Valid() {
		return fmt.Errorf("workflow %s: trigger %q is pinned to platform %q, which is not in the platform contract", def.ID, def.Trigger.Ref, platform)
	}
	def.Trigger.Platform = pin
	return nil
}
