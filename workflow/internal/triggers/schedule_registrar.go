package triggers

import (
	"fmt"
	"sync"

	"github.com/robfig/cron/v3"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// ScheduleFireFunc is invoked when a scheduled workflow's cron job fires.
// Implementations typically synthesize an Event and hand it to engine.HandleEvent.
type ScheduleFireFunc func(workflowID string)

type ScheduleTriggerRegistrar struct {
	mu     sync.Mutex
	cron   *cron.Cron
	onFire ScheduleFireFunc
	jobs   map[string]cron.EntryID // workflowID -> cron entry
}

func NewScheduleTriggerRegistrar(onFire ScheduleFireFunc) *ScheduleTriggerRegistrar {
	return &ScheduleTriggerRegistrar{
		cron:   cron.New(),
		onFire: onFire,
		jobs:   make(map[string]cron.EntryID),
	}
}

func (r *ScheduleTriggerRegistrar) Start() {
	r.cron.Start()
}

func (r *ScheduleTriggerRegistrar) Stop() {
	ctx := r.cron.Stop()
	<-ctx.Done()
}

func (r *ScheduleTriggerRegistrar) Register(workflowID string, trigger *types.TriggerConfig) error {
	if trigger == nil || trigger.Type != "schedule" || trigger.Schedule == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	// Replace any prior schedule for this workflow.
	if prev, ok := r.jobs[workflowID]; ok {
		r.cron.Remove(prev)
		delete(r.jobs, workflowID)
	}

	wid := workflowID
	id, err := r.cron.AddFunc(trigger.Schedule, func() {
		if r.onFire != nil {
			r.onFire(wid)
		}
	})
	if err != nil {
		return fmt.Errorf("cron.AddFunc(%q): %w", trigger.Schedule, err)
	}
	r.jobs[workflowID] = id
	return nil
}

func (r *ScheduleTriggerRegistrar) Unregister(workflowID string, _ *types.TriggerConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id, ok := r.jobs[workflowID]; ok {
		r.cron.Remove(id)
		delete(r.jobs, workflowID)
	}
	return nil
}

// triggerForTest synchronously invokes onFire for a registered workflow.
// Intended for use in tests only.
func (r *ScheduleTriggerRegistrar) triggerForTest(workflowID string) {
	r.mu.Lock()
	_, exists := r.jobs[workflowID]
	r.mu.Unlock()
	if !exists {
		return
	}
	if r.onFire != nil {
		r.onFire(workflowID)
	}
}
