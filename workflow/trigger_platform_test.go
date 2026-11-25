package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
)

// fakeTriggers answers GetTriggerByCanonicalId from a map of canonical id to
// platform, or with err for every id when err is set.
type fakeTriggers struct {
	platforms map[string]string
	err       error
}

func (f *fakeTriggers) GetTriggerByCanonicalId(_ context.Context, req *dbv1.GetByCanonicalIdRequest) (*dbv1.TriggerResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	platform, ok := f.platforms[req.GetCanonicalId()]
	if !ok {
		return nil, twirp.NotFoundError("no trigger")
	}
	return &dbv1.TriggerResponse{Trigger: &dbv1.Trigger{Platform: platform}}, nil
}

func refWorkflow(id, ref string) *dbv1.Workflow {
	wf := storedWorkflow(id)
	if ref != "" {
		wf.TriggerJson = `{"type":"event","event":"channel.follow","$ref":"` + ref + `"}`
	}
	return wf
}

func TestReconcileResolvesEachWorkflowsTriggerPlatform(t *testing.T) {
	cases := []struct {
		name       string
		ref        string
		triggers   *fakeTriggers
		wantPin    string
		wantLoaded bool
	}{
		{name: "no $ref stays unpinned", ref: "", triggers: &fakeTriggers{}, wantPin: "", wantLoaded: true},
		{
			name: "a pinned module trigger pins the workflow", ref: "woofx3_twitch:trigger:channel_follow",
			triggers: &fakeTriggers{platforms: map[string]string{"woofx3_twitch:trigger:channel_follow": "twitch"}},
			wantPin:  "twitch", wantLoaded: true,
		},
		{
			name: "an unpinned module trigger stays unpinned", ref: "pups:trigger:follow",
			triggers: &fakeTriggers{platforms: map[string]string{"pups:trigger:follow": ""}},
			wantPin:  "", wantLoaded: true,
		},
		{
			name: "a $ref naming no trigger row stays unpinned", ref: "gone:trigger:follow",
			triggers: &fakeTriggers{platforms: map[string]string{}}, wantPin: "", wantLoaded: true,
		},
		{
			name: "an unreadable trigger row fails the load", ref: "woofx3_twitch:trigger:channel_follow",
			triggers: &fakeTriggers{err: errors.New("db proxy unreachable")}, wantLoaded: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logger := &countingLogger{}
			registry := newRefusingRegistry()
			db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{refWorkflow("wf-1", tc.ref)}}
			manager := NewWorkflowManager(logger, registry, db)
			manager.SetTriggerLookup(tc.triggers)

			newReconciler(manager, registry, db, logger, time.Minute).reconcileOnce(context.Background())

			defs := registry.List()
			if !tc.wantLoaded {
				if len(defs) != 0 {
					t.Fatalf("registered %v, want nothing", defs)
				}
				if got, _ := manager.Health().Status("wf-1"); got.Status != WorkflowHealthError {
					t.Fatalf("health = %+v, want an error", got)
				}
				return
			}
			if len(defs) != 1 {
				t.Fatalf("registered %v, want wf-1", defs)
			}
			if defs[0].Trigger.Platform != tc.wantPin {
				t.Fatalf("pin = %q, want %q", defs[0].Trigger.Platform, tc.wantPin)
			}
		})
	}
}

func TestLoadWorkflowsFromDBPinsTheTriggerPlatform(t *testing.T) {
	registry := newRefusingRegistry()
	db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{refWorkflow("wf-1", "woofx3_twitch:trigger:channel_follow")}}
	manager := NewWorkflowManager(&countingLogger{}, registry, db)
	manager.SetTriggerLookup(&fakeTriggers{platforms: map[string]string{"woofx3_twitch:trigger:channel_follow": "twitch"}})

	if err := manager.LoadWorkflowsFromDB(context.Background()); err != nil {
		t.Fatalf("LoadWorkflowsFromDB: %v", err)
	}
	if defs := registry.List(); len(defs) != 1 || defs[0].Trigger.Platform != "twitch" {
		t.Fatalf("registered %v, want wf-1 pinned to twitch", defs)
	}
}
