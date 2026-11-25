package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
)

// fakeTriggers serves trigger rows by canonical id, or err for every read
// when err is set, and counts the reads.
type fakeTriggers struct {
	mu    sync.Mutex
	rows  map[string]string
	err   error
	lists int
	gets  int
}

func pinnedRows(pins map[string]string) *fakeTriggers {
	return &fakeTriggers{rows: pins}
}

func (f *fakeTriggers) set(ref, platform string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows[ref] = platform
}

func (f *fakeTriggers) GetTriggerByCanonicalId(_ context.Context, req *dbv1.GetByCanonicalIdRequest) (*dbv1.TriggerResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gets++
	if f.err != nil {
		return nil, f.err
	}
	if !strings.Contains(req.GetCanonicalId(), ":trigger:") {
		return nil, twirp.InvalidArgumentError("canonical_id", "not a canonical id")
	}
	platform, ok := f.rows[req.GetCanonicalId()]
	if !ok {
		return nil, twirp.NotFoundError("no trigger")
	}
	return &dbv1.TriggerResponse{Trigger: &dbv1.Trigger{Platform: platform}}, nil
}

func (f *fakeTriggers) ListTriggers(context.Context, *dbv1.ListTriggersRequest) (*dbv1.ListTriggersResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lists++
	if f.err != nil {
		return nil, f.err
	}
	rows := make([]*dbv1.Trigger, 0, len(f.rows))
	for ref, platform := range f.rows {
		module, manifestID, _ := strings.Cut(ref, ":trigger:")
		rows = append(rows, &dbv1.Trigger{CreatedByRef: module, ManifestId: manifestID, Platform: platform})
	}
	return &dbv1.ListTriggersResponse{Triggers: rows}, nil
}

func refWorkflow(id, ref string) *dbv1.Workflow {
	wf := storedWorkflow(id)
	if ref != "" {
		wf.TriggerJson = `{"type":"event","event":"channel.follow","$ref":"` + ref + `"}`
	}
	return wf
}

const twitchFollow = "woofx3_twitch:trigger:channel_follow"

func TestReconcileResolvesEachWorkflowsTriggerPlatform(t *testing.T) {
	cases := []struct {
		name       string
		ref        string
		triggers   *fakeTriggers
		wantPin    string
		wantLoaded bool
	}{
		{name: "no $ref stays unpinned", ref: "", triggers: pinnedRows(map[string]string{}), wantPin: "", wantLoaded: true},
		{name: "a pinned module trigger pins the workflow", ref: twitchFollow, triggers: pinnedRows(map[string]string{twitchFollow: "twitch"}), wantPin: "twitch", wantLoaded: true},
		{name: "an unpinned module trigger stays unpinned", ref: "pups:trigger:follow", triggers: pinnedRows(map[string]string{"pups:trigger:follow": ""}), wantPin: "", wantLoaded: true},
		{name: "a $ref naming no trigger row stays unpinned", ref: "gone:trigger:follow", triggers: pinnedRows(map[string]string{}), wantPin: "", wantLoaded: true},
		{name: "a $ref that is not a canonical id stays unpinned", ref: "not-a-ref", triggers: pinnedRows(map[string]string{}), wantPin: "", wantLoaded: true},
		{name: "a row pinned outside the contract fails the load", ref: twitchFollow, triggers: pinnedRows(map[string]string{twitchFollow: "Twitch"}), wantLoaded: false},
		{name: "an unreadable trigger list fails the load", ref: twitchFollow, triggers: &fakeTriggers{err: errors.New("db proxy unreachable")}, wantLoaded: false},
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
			if string(defs[0].Trigger.Platform) != tc.wantPin {
				t.Fatalf("pin = %q, want %q", defs[0].Trigger.Platform, tc.wantPin)
			}
		})
	}
}

func TestReconcileRepinsALoadedWorkflowWhenItsTriggerIsRepinned(t *testing.T) {
	logger := &countingLogger{}
	registry := newRefusingRegistry()
	db := &fakeWorkflowDB{workflows: []*dbv1.Workflow{refWorkflow("wf-1", twitchFollow)}}
	triggers := pinnedRows(map[string]string{twitchFollow: ""})
	manager := NewWorkflowManager(logger, registry, db)
	manager.SetTriggerLookup(triggers)
	reconciler := newReconciler(manager, registry, db, logger, time.Minute)
	reconciler.reconcileOnce(context.Background())

	triggers.set(twitchFollow, "twitch")
	reconciler.reconcileOnce(context.Background())

	if defs := registry.List(); len(defs) != 1 || defs[0].Trigger.Platform != "twitch" {
		t.Fatalf("registered %v, want wf-1 repinned to twitch", defs)
	}
}

func TestAPassReadsTheTriggersOnceHoweverManyWorkflowsReferToThem(t *testing.T) {
	logger := &countingLogger{}
	registry := newRefusingRegistry()
	var workflows []*dbv1.Workflow
	for _, id := range []string{"wf-1", "wf-2", "wf-3", "wf-4"} {
		workflows = append(workflows, refWorkflow(id, twitchFollow))
	}
	db := &fakeWorkflowDB{workflows: workflows}
	triggers := pinnedRows(map[string]string{twitchFollow: "twitch"})
	manager := NewWorkflowManager(logger, registry, db)
	manager.SetTriggerLookup(triggers)

	if err := manager.LoadWorkflowsFromDB(context.Background()); err != nil {
		t.Fatalf("LoadWorkflowsFromDB: %v", err)
	}
	newReconciler(manager, registry, db, logger, time.Minute).reconcileOnce(context.Background())

	if triggers.lists != 2 || triggers.gets != 0 {
		t.Fatalf("lists = %d, gets = %d; want one list per pass and no single reads", triggers.lists, triggers.gets)
	}
	for _, def := range registry.List() {
		if def.Trigger.Platform != "twitch" {
			t.Fatalf("%s pin = %q, want twitch", def.ID, def.Trigger.Platform)
		}
	}
}

// singleWorkflowDB answers GetWorkflow with one workflow, as a lifecycle event reads it.
type singleWorkflowDB struct {
	fakeWorkflowDB
	workflow *dbv1.Workflow
}

func (s *singleWorkflowDB) GetWorkflow(context.Context, *dbv1.GetWorkflowRequest) (*dbv1.WorkflowResponse, error) {
	return &dbv1.WorkflowResponse{Workflow: s.workflow}, nil
}

func TestALifecycleLoadWithAMalformedRefStillLoads(t *testing.T) {
	registry := newRefusingRegistry()
	db := &singleWorkflowDB{workflow: refWorkflow("wf-1", "not-a-ref")}
	manager := NewWorkflowManager(&countingLogger{}, registry, db)
	manager.SetTriggerLookup(pinnedRows(map[string]string{}))

	evt, err := cloudevents.WorkflowEvent.WorkflowChangeEvent(cloudevents.OperationUpdated, "wf-1", "test")
	if err != nil {
		t.Fatal(err)
	}
	manager.HandleWorkflowCreateOrUpdate(evt)

	if defs := registry.List(); len(defs) != 1 || defs[0].Trigger.Platform != "" {
		t.Fatalf("registered %v, want wf-1 loaded unpinned", defs)
	}
}
