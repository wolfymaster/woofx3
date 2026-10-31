package engine

import (
	"errors"
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func registerNoopAction(t *testing.T, e *Engine[execSvcs]) {
	t.Helper()
	noop := func(tasks.ActionContext[execSvcs], map[string]any) (map[string]any, error) { return nil, nil }
	if err := e.RegisterAction("noop", noop); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
}

func envProbeWorkflow() *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:      "wf-env",
		Name:    "env probe",
		Trigger: &types.TriggerConfig{Type: types.TriggerTypeEvent, Event: "channel.cheer"},
		Tasks: []types.TaskDefinition{
			{ID: "s1", Type: types.TaskTypeAction, Action: "noop", Parameters: map[string]any{"message": "${trigger.data.userName}"}},
		},
	}
}

func TestRegisterWorkflowRefusesEnvReferences(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(def *types.WorkflowDefinition)
		wantPath string
	}{
		{
			name: "nested step parameter",
			mutate: func(def *types.WorkflowDefinition) {
				def.Tasks[0].Parameters = map[string]any{
					"request": map[string]any{
						"headers": []any{"plain", map[string]any{"auth": "Bearer ${env.TWITCH_TOKEN}"}},
					},
				}
			},
			wantPath: "tasks[0].parameters.request.headers[1].auth",
		},
		{
			name: "trigger condition",
			mutate: func(def *types.WorkflowDefinition) {
				def.Trigger.Conditions = []types.ConditionConfig{{Field: "${trigger.data.user}", Operator: "eq", Value: "${env.OWNER}"}}
			},
			wantPath: "trigger.conditions[0].value",
		},
		{
			name: "step condition",
			mutate: func(def *types.WorkflowDefinition) {
				def.Tasks[0].Condition = &types.ConditionConfig{Field: "${env.FLAG}", Operator: "exists"}
			},
			wantPath: "tasks[0].condition.field",
		},
		{
			name: "wait condition",
			mutate: func(def *types.WorkflowDefinition) {
				def.Tasks = append(def.Tasks, types.TaskDefinition{
					ID:   "w1",
					Type: types.TaskTypeWait,
					Wait: &types.WaitConfig{
						Type:       "event",
						Event:      "channel.follow",
						Conditions: []types.ConditionConfig{{Field: "${event.data.user}", Operator: "eq", Value: "${env.OWNER}"}},
					},
				})
			},
			wantPath: "tasks[1].wait.conditions[0].value",
		},
		{
			name: "disabled step",
			mutate: func(def *types.WorkflowDefinition) {
				def.Tasks[0].Disabled = true
				def.Tasks[0].Parameters = map[string]any{"message": "${env.HOME}"}
			},
			wantPath: "tasks[0].parameters.message",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newExecEngine(t)
			registerNoopAction(t, e)
			def := envProbeWorkflow()
			tt.mutate(def)

			err := e.RegisterWorkflow(def)
			if !errors.Is(err, ErrEnvReference) {
				t.Fatalf("RegisterWorkflow err = %v, want ErrEnvReference", err)
			}
			if !strings.Contains(err.Error(), tt.wantPath+": ") {
				t.Fatalf("RegisterWorkflow err = %v, want path %s", err, tt.wantPath)
			}
			if _, err := e.GetWorkflow(def.ID); err == nil {
				t.Error("a workflow referencing env was registered")
			}
		})
	}
}

func TestRegisterWorkflowAcceptsDefinitionWithoutEnv(t *testing.T) {
	e := newExecEngine(t)
	registerNoopAction(t, e)
	if err := e.RegisterWorkflow(envProbeWorkflow()); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
}

func TestRegisterWorkflowRefusesInvalidFunctionCalls(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(def *types.WorkflowDefinition)
		wantPath string
	}{
		{
			name: "unknown function in a nested parameter",
			mutate: func(def *types.WorkflowDefinition) {
				def.Tasks[0].Parameters = map[string]any{"request": []any{"plain", map[string]any{"text": "Hi ${shout(1)}"}}}
			},
			wantPath: "tasks[0].parameters.request[1].text",
		},
		{
			name: "wrong argument count in a trigger condition",
			mutate: func(def *types.WorkflowDefinition) {
				def.Trigger.Conditions = []types.ConditionConfig{{Field: "${add(1)}", Operator: "exists"}}
			},
			wantPath: "trigger.conditions[0].field",
		},
		{
			name: "disabled step",
			mutate: func(def *types.WorkflowDefinition) {
				def.Tasks[0].Disabled = true
				def.Tasks[0].Parameters = map[string]any{"message": "${round(}"}
			},
			wantPath: "tasks[0].parameters.message",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := newExecEngine(t)
			registerNoopAction(t, e)
			def := envProbeWorkflow()
			tc.mutate(def)
			err := e.RegisterWorkflow(def)
			if !errors.Is(err, expression.ErrFunctionCall) {
				t.Fatalf("got %v, want ErrFunctionCall", err)
			}
			if !strings.Contains(err.Error(), tc.wantPath+": ") {
				t.Fatalf("RegisterWorkflow err = %v, want path %s", err, tc.wantPath)
			}
		})
	}
}

func TestRegisterWorkflowAcceptsValidFunctionCalls(t *testing.T) {
	e := newExecEngine(t)
	registerNoopAction(t, e)
	def := envProbeWorkflow()
	def.Tasks[0].Parameters = map[string]any{"message": "Rolled ${random(1, 6)}: ${round(trigger.data.x, 2)}"}
	if err := e.RegisterWorkflow(def); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
}
